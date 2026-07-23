import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { shouldIncludeDocument } from "./document-policy";

config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

interface Chunk {
  content: string;
  source: "transcript" | "textbook";
  title: string;
  speaker?: string;
  date?: string | null;
  url?: string;
  chunk_index: number;
  page?: number;
}

interface DocumentRow {
  source: string;
  title: string;
  speaker: string | null;
  date: string | null;
  url: string | null;
}

async function getEmbeddings(texts: string[]): Promise<number[][]> {
  // Retry transient failures (5xx, 429, network hiccups) with backoff — a
  // single flaky response otherwise kills a ~100-batch run mid-way.
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    let res: Response;
    try {
      res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "text-embedding-3-small",
          input: texts,
        }),
      });
    } catch (err) {
      lastError = err as Error;
      console.warn(`  Embedding attempt ${attempt} failed (network); retrying...`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      continue;
    }

    if (res.ok) {
      const json = await res.json();
      return json.data.map((d: { embedding: number[] }) => d.embedding);
    }

    const err = await res.text();
    lastError = new Error(`OpenAI API error: ${res.status} ${err}`);
    if (res.status >= 500 || res.status === 429) {
      console.warn(`  Embedding attempt ${attempt} failed (${res.status}); retrying...`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      continue;
    }
    throw lastError; // 4xx other than 429: not transient, fail fast
  }
  throw lastError;
}

async function main() {
  const chunksPath = process.argv[2];
  if (!chunksPath) {
    console.error(
      "Usage: npm run embed -- <path-to-chunks.jsonl>\n" +
        "Example: npm run embed -- data/processed/chunks.jsonl"
    );
    process.exit(1);
  }

  if (!OPENAI_API_KEY) {
    console.error("Missing OPENAI_API_KEY in .env.local");
    process.exit(1);
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL in .env.local");
    process.exit(1);
  }

  console.log(`Loading chunks from ${chunksPath}...`);
  const lines = readFileSync(chunksPath, "utf-8").split("\n").filter(Boolean);
  const inputChunks: Chunk[] = lines.map((line) => JSON.parse(line));
  const chunks = inputChunks.filter((chunk) =>
    shouldIncludeDocument({ source: chunk.source, title: chunk.title })
  );
  const excludedChunks = inputChunks.length - chunks.length;
  if (excludedChunks > 0) {
    console.log(
      `Skipped ${excludedChunks} chunk(s) excluded by scripts/document-policy.ts`
    );
  }
  console.log(`Loaded ${chunks.length} chunks`);

  // ----- Step 1: upsert documents and build a (source,title) → id map -----

  const docMap = new Map<string, DocumentRow>();
  for (const chunk of chunks) {
    const key = `${chunk.source}::${chunk.title}`;
    if (!docMap.has(key)) {
      docMap.set(key, {
        source: chunk.source,
        title: chunk.title,
        speaker: chunk.speaker ?? null,
        date: chunk.date ?? null,
        url: chunk.url ?? null,
      });
    }
  }

  console.log(`Upserting ${docMap.size} documents...`);
  const { data: docRows, error: docError } = await supabase
    .from("documents")
    .upsert(Array.from(docMap.values()), { onConflict: "source,title" })
    .select("id, source, title");

  if (docError || !docRows) {
    console.error("Error upserting documents:", docError);
    process.exit(1);
  }

  const docIdByKey = new Map<string, number>();
  for (const row of docRows) {
    docIdByKey.set(`${row.source}::${row.title}`, row.id as number);
  }

  // ----- Step 2: embed and insert chunks in batches -----

  const BATCH_SIZE = 100;
  let embedded = 0;

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const texts = batch.map((c) => c.content);

    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(chunks.length / BATCH_SIZE);
    console.log(`Embedding batch ${batchNum}/${totalBatches}...`);

    const embeddings = await getEmbeddings(texts);

    const rows = batch.map((chunk, j) => {
      const documentId = docIdByKey.get(`${chunk.source}::${chunk.title}`);
      if (!documentId) {
        throw new Error(
          `No document_id found for ${chunk.source}::${chunk.title}`
        );
      }
      return {
        document_id: documentId,
        content: chunk.content,
        page: chunk.page ?? null,
        chunk_index: chunk.chunk_index,
        embedding: JSON.stringify(embeddings[j]),
      };
    });

    // Retry transient failures (e.g. free-tier statement timeouts / cold
    // compute) with backoff before giving up on the run.
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= 5; attempt++) {
      const { error } = await supabase.from("chunks").upsert(rows, {
        onConflict: "document_id,chunk_index,page",
      });
      if (!error) {
        lastError = null;
        break;
      }
      lastError = error;
      console.warn(
        `  Batch ${batchNum} insert attempt ${attempt} failed (${(error as { code?: string }).code ?? "?"}); retrying...`
      );
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }

    if (lastError) {
      console.error(`Error inserting batch ${batchNum}:`, lastError);
      process.exit(1);
    }

    embedded += batch.length;
    console.log(`  Stored ${embedded}/${chunks.length}`);

    // Small delay to stay within rate limits
    if (i + BATCH_SIZE < chunks.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  // ----- Step 3: delete stale chunks -----
  // The upsert above overwrites (document_id, chunk_index, page) rows in
  // place, but a document whose chunk count SHRANK (e.g. after stripper
  // improvements) leaves its old tail rows behind, and retrieval would serve
  // that stale text. Chunk indexes restart per page for the textbook, so
  // group by (document, page). Documents absent from this chunks file are
  // left untouched.

  const groups = new Map<
    string,
    { docId: number; page: number | null; maxIdx: number }
  >();
  for (const chunk of chunks) {
    const docId = docIdByKey.get(`${chunk.source}::${chunk.title}`)!;
    const page = chunk.page ?? null;
    const key = `${docId}::${page}`;
    const g = groups.get(key);
    if (g) g.maxIdx = Math.max(g.maxIdx, chunk.chunk_index);
    else groups.set(key, { docId, page, maxIdx: chunk.chunk_index });
  }

  console.log(`Deleting stale chunks across ${groups.size} (doc, page) groups...`);
  let staleDeleted = 0;
  for (const g of groups.values()) {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      let q = supabase
        .from("chunks")
        .delete({ count: "exact" })
        .eq("document_id", g.docId)
        .gt("chunk_index", g.maxIdx);
      q = g.page === null ? q.is("page", null) : q.eq("page", g.page);
      const { count, error } = await q;
      if (!error) {
        staleDeleted += count ?? 0;
        lastError = null;
        break;
      }
      lastError = error;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
    if (lastError) {
      console.error("Error deleting stale chunks:", lastError);
      process.exit(1);
    }
  }
  console.log(`  Deleted ${staleDeleted} stale chunks`);

  console.log("Done! All chunks embedded and stored in Supabase.");
}

main();
