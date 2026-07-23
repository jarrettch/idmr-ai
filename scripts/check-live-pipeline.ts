import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { resolveDocumentTitle } from "../src/lib/resolve-document";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) {
  throw new Error(
    "Live checks require NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY"
  );
}

const supabase = createClient(url, secret);
let failed = 0;

function check(name: string, passed: boolean, detail: string): void {
  if (passed) {
    console.log(`✓ ${name}`);
    return;
  }
  failed++;
  console.error(`✗ ${name}\n  ${detail}`);
}

function distinctTitles(rows: Array<Record<string, unknown>> | null): string[] {
  return [
    ...new Set((rows ?? []).map((row) => String(row.title))),
  ].sort();
}

async function main(): Promise<void> {
  const exactTitle = "Satanic Spirits";

  const { data: sequential, error: sequentialError } = await supabase.rpc(
    "chunks_by_title",
    {
      filter_title: exactTitle,
      max_chunks: 1000,
    }
  );
  const sequentialTitles = distinctTitles(sequential);
  check(
    "chunks_by_title prefers an exact title",
    !sequentialError &&
      sequentialTitles.length === 1 &&
      sequentialTitles[0] === exactTitle,
    `error=${sequentialError?.message ?? "none"} titles=${JSON.stringify(sequentialTitles)}`
  );

  const { getEmbedding } = await import("../src/lib/embeddings");
  const embedding = await getEmbedding(
    "What does this transcript teach about satanic spirits?"
  );
  const { data: filtered, error: filteredError } = await supabase.rpc(
    "match_chunks_filtered",
    {
      query_embedding: embedding,
      filter_title: exactTitle,
      match_count: 1000,
      match_threshold: -2,
    }
  );
  const filteredTitles = distinctTitles(filtered);
  check(
    "match_chunks_filtered prefers an exact title",
    !filteredError &&
      filteredTitles.length === 1 &&
      filteredTitles[0] === exactTitle,
    `error=${filteredError?.message ?? "none"} titles=${JSON.stringify(filteredTitles)}`
  );

  const originalQuery = "Summarize the Sunday Morning in 74/75 transcript";
  const canonical = resolveDocumentTitle(originalQuery);
  const { data: sundayChunks, error: sundayError } = canonical
    ? await supabase.rpc("chunks_by_title", {
        filter_title: canonical,
        max_chunks: 40,
      })
    : { data: null, error: null };
  const sundayTitles = distinctTitles(sundayChunks);
  check(
    "original Sunday Morning query reaches the expected live document",
    canonical === "Truth Through Dr. Kinley's Vision" &&
      !sundayError &&
      (sundayChunks?.length ?? 0) > 0 &&
      sundayTitles.length === 1 &&
      sundayTitles[0] === canonical,
    `canonical=${JSON.stringify(canonical)} error=${sundayError?.message ?? "none"} titles=${JSON.stringify(sundayTitles)}`
  );

  const { data: excluded, error: excludedError } = await supabase
    .from("documents")
    .select("id")
    .eq("source", "transcript")
    .eq("title", "Transcripts")
    .limit(1);
  check(
    'junk "Transcripts" document is absent',
    !excludedError && (excluded?.length ?? 0) === 0,
    `error=${excludedError?.message ?? "none"} rows=${excluded?.length ?? 0}`
  );

  const forbiddenPhrases = [
    "indicates that the speaker ended",
    "group comments and general conversation has not been transcribed",
    "audience responses are only included",
    "means that the word or sentence was not completed",
  ];
  for (const phrase of forbiddenPhrases) {
    const { data, error } = await supabase
      .from("chunks")
      .select("id")
      .ilike("content", `%${phrase}%`)
      .limit(1);
    check(
      `live chunks exclude ${JSON.stringify(phrase)}`,
      !error && (data?.length ?? 0) === 0,
      `error=${error?.message ?? "none"} rows=${data?.length ?? 0}`
    );
  }

  if (failed > 0) {
    console.error(`\n${failed} live pipeline check(s) FAILED`);
    process.exit(1);
  }
  console.log("\n✓ all live pipeline checks pass");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
