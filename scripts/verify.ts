import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

async function main() {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  );

  const { count: docCount } = await sb
    .from("documents")
    .select("*", { count: "exact", head: true });
  const { count: chunkCount } = await sb
    .from("chunks")
    .select("*", { count: "exact", head: true });

  console.log(`documents: ${docCount}`);
  console.log(`chunks:    ${chunkCount}`);

  const { data: bySource } = await sb
    .from("documents")
    .select("source")
    .order("source");
  const sourceCounts = (bySource ?? []).reduce<Record<string, number>>(
    (acc, r) => {
      acc[r.source] = (acc[r.source] ?? 0) + 1;
      return acc;
    },
    {}
  );
  console.log("by source: ", sourceCounts);

  // Quick retrieval smoke test
  const { getEmbedding } = await import("../src/lib/embeddings");
  const embedding = await getEmbedding("what does Kinley teach about the carnal mind");
  const { data: hits, error } = await sb.rpc("match_chunks", {
    query_embedding: embedding,
    match_count: 3,
    match_threshold: 0.15,
  });
  if (error) {
    console.error("match_chunks error:", error);
    process.exit(1);
  }
  console.log("\nTop 3 hits for 'carnal mind' query:");
  for (const h of hits ?? []) {
    console.log(
      `  [${h.similarity.toFixed(3)}] ${h.title} — ${h.content.slice(0, 80)}...`
    );
  }
}

main();
