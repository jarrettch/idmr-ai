import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY!;

interface Chunk {
  content: string;
  source: string;
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
  const res = await fetch("https://api.openai.com/v1/embeddings", {
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

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI API error: ${res.status} ${err}`);
  }

  const json = await res.json();
  return json.data.map((d: { embedding: number[] }) => d.embedding);
}

async function main() {
  const chunksPath = process.argv[2];
  if (!chunksPath) {
    console.error(
      "Usage: npx tsx scripts/embed.ts <path-to-chunks.jsonl>\n" +
        "Example: npx tsx scripts/embed.ts data/processed/chunks.jsonl"
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
  const chunks: Chunk[] = lines.map((l) => JSON.parse(l));
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

    const { error } = await supabase.from("chunks").upsert(rows, {
      onConflict: "document_id,chunk_index,page",
    });

    if (error) {
      console.error(`Error inserting batch ${batchNum}:`, error);
      process.exit(1);
    }

    embedded += batch.length;
    console.log(`  Stored ${embedded}/${chunks.length}`);

    // Small delay to stay within rate limits
    if (i + BATCH_SIZE < chunks.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  console.log("Done! All chunks embedded and stored in Supabase.");
}

main();
