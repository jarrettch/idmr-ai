import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { shouldIncludeDocument } from "./document-policy";
import {
  planTailTrims,
  planFullSnapshot,
  type DbChunkRow,
  type FileChunkRef,
} from "./reconcile";

config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);

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

// One retry policy for every transient-failure site (Supabase timeouts, cold
// compute). Backoff scales with the attempt; no sleep after the final failure.
async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  attempts = 5,
  baseDelayMs = 1000
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < attempts) {
        console.warn(`  ${label}: attempt ${attempt} failed; retrying...`);
        await new Promise((r) => setTimeout(r, baseDelayMs * attempt));
      }
    }
  }
  throw lastError;
}

// Supabase client calls report failure via `error` instead of throwing; wrap
// them so withRetry sees a rejection.
function orThrow<T extends { error: unknown }>(result: T): T {
  if (result.error) throw result.error;
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const fullSnapshot = args.includes("--full-snapshot");
  const chunksPath = args.find((a) => !a.startsWith("--"));
  if (!chunksPath) {
    console.error(
      "Usage: npm run embed -- <path-to-chunks.jsonl> [--full-snapshot]\n" +
        "Example: npm run embed -- data/processed/chunks.jsonl\n\n" +
        "Default: upserts the file's chunks and trims stale chunk_index tails\n" +
        "only within (document, page) groups present in the file — safe for\n" +
        "partial files, but a page or document dropped by a re-chunk keeps its\n" +
        "old rows.\n" +
        "--full-snapshot: DESTRUCTIVE. Treats the file as the complete corpus:\n" +
        "also deletes rows whose (page, chunk_index) vanished from a present\n" +
        "document, and deletes documents (with their chunks) absent from the\n" +
        "file entirely. Never combine with a partial chunks file."
    );
    process.exit(1);
  }

  if (!process.env.OPENAI_API_KEY) {
    console.error("Missing OPENAI_API_KEY in .env.local");
    process.exit(1);
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL in .env.local");
    process.exit(1);
  }

  // Imported after dotenv so the AI SDK sees OPENAI_API_KEY (same pattern as
  // verify.ts / check-live-pipeline.ts).
  const { getEmbeddings } = await import("../src/lib/embeddings");

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

  if (fullSnapshot && chunks.length === 0) {
    console.error(
      "--full-snapshot with an empty chunks file would delete every document; refusing."
    );
    process.exit(1);
  }

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

    // The AI SDK retries transient failures (429/5xx/network) with backoff —
    // a single flaky response otherwise kills a ~100-batch run mid-way.
    const { embeddings } = await getEmbeddings(texts, { maxRetries: 4 });

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

    try {
      await withRetry(`batch ${batchNum} insert`, async () =>
        orThrow(
          await supabase.from("chunks").upsert(rows, {
            onConflict: "document_id,chunk_index,page",
          })
        )
      );
    } catch (err) {
      console.error(`Error inserting batch ${batchNum}:`, err);
      process.exit(1);
    }

    embedded += batch.length;
    console.log(`  Stored ${embedded}/${chunks.length}`);

    // Small delay to stay within rate limits
    if (i + BATCH_SIZE < chunks.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  // ----- Step 3: reconcile stale chunks -----
  // The upsert above overwrites (document_id, chunk_index, page) rows in
  // place but never deletes. Deletion semantics live in scripts/reconcile.ts:
  // default mode trims shrunken tails within (document, page) groups present
  // in this file (partial-safe; dropped pages/documents keep their rows);
  // --full-snapshot reconciles the DB to exactly this file's contents.

  const fileRefs: FileChunkRef[] = chunks.map((chunk) => ({
    docId: docIdByKey.get(`${chunk.source}::${chunk.title}`)!,
    page: chunk.page ?? null,
    chunkIndex: chunk.chunk_index,
  }));

  const trims = planTailTrims(fileRefs);
  console.log(
    `Deleting stale chunk tails across ${trims.length} (doc, page) groups...`
  );
  let staleDeleted = 0;
  try {
    for (const g of trims) {
      const { count } = await withRetry(
        `stale trim doc ${g.docId} page ${g.page}`,
        async () => {
          let q = supabase
            .from("chunks")
            .delete({ count: "exact" })
            .eq("document_id", g.docId)
            .gt("chunk_index", g.maxIdx);
          q = g.page === null ? q.is("page", null) : q.eq("page", g.page);
          return orThrow(await q);
        },
        3
      );
      staleDeleted += count ?? 0;
    }
  } catch (err) {
    console.error("Error deleting stale chunks:", err);
    process.exit(1);
  }
  console.log(`  Deleted ${staleDeleted} stale tail chunks`);

  if (fullSnapshot) {
    try {
      await reconcileFullSnapshot(fileRefs);
    } catch (err) {
      console.error("Error during full-snapshot reconciliation:", err);
      process.exit(1);
    }
  }

  console.log("Done! All chunks embedded and stored in Supabase.");
}

async function reconcileFullSnapshot(fileRefs: FileChunkRef[]) {
  console.log("Full-snapshot reconciliation...");
  const presentDocIds = Array.from(new Set(fileRefs.map((r) => r.docId)));

  // Page through the present documents' chunk keys (Supabase caps selects at
  // 1000 rows).
  const dbChunks: DbChunkRow[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data } = await withRetry(`chunk key fetch @${from}`, async () =>
      orThrow(
        await supabase
          .from("chunks")
          .select("id, document_id, page, chunk_index")
          .in("document_id", presentDocIds)
          .order("id", { ascending: true })
          .range(from, from + PAGE - 1)
      )
    );
    const rows = data ?? [];
    for (const row of rows) {
      dbChunks.push({
        id: row.id as number,
        docId: row.document_id as number,
        page: (row.page as number | null) ?? null,
        chunkIndex: row.chunk_index as number,
      });
    }
    if (rows.length < PAGE) break;
  }

  const { data: docData } = await withRetry("document list fetch", async () =>
    orThrow(await supabase.from("documents").select("id, source, title"))
  );
  const dbDocs = (docData ?? []).map((d) => ({
    id: d.id as number,
    source: d.source as string,
    title: d.title as string,
  }));

  const { staleChunkIds, absentDocs } = planFullSnapshot(
    fileRefs,
    dbChunks,
    dbDocs
  );

  console.log(
    `  ${staleChunkIds.length} stale chunk(s) in present documents; ` +
      `${absentDocs.length} document(s) absent from the snapshot`
  );

  const DELETE_BATCH = 500;
  for (let i = 0; i < staleChunkIds.length; i += DELETE_BATCH) {
    const ids = staleChunkIds.slice(i, i + DELETE_BATCH);
    await withRetry(`stale chunk delete batch ${i / DELETE_BATCH + 1}`, async () =>
      orThrow(await supabase.from("chunks").delete().in("id", ids))
    );
  }

  for (const doc of absentDocs) {
    console.log(`  Deleting absent document: ${doc.source} :: ${doc.title}`);
  }
  if (absentDocs.length > 0) {
    // documents(id) cascades to chunks, so this removes their chunks too.
    await withRetry("absent document delete", async () =>
      orThrow(
        await supabase
          .from("documents")
          .delete()
          .in("id", absentDocs.map((d) => d.id))
      )
    );
  }
}

main();
