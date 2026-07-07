import { readFileSync } from "fs";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);

const MAP_PATH = "scripts/soundcloud-urls.json";

async function fetchTranscriptTitles(): Promise<string[]> {
  const { data, error } = await supabase
    .from("documents")
    .select("title")
    .eq("source", "transcript")
    .order("title");

  if (error) {
    console.error("Error fetching documents:", error);
    process.exit(1);
  }
  return (data ?? []).map((r) => r.title as string);
}

async function main() {
  const args = process.argv.slice(2);
  const list = args.includes("--list");
  const dryRun = args.includes("--dry-run");

  if (list) {
    const titles = await fetchTranscriptTitles();
    console.log(`${titles.length} transcript titles:\n`);
    for (const t of titles) console.log(`  ${t}`);
    return;
  }

  // Load the title -> SoundCloud URL map, ignoring `_`-prefixed helper keys
  // and blank values (unfilled placeholders).
  const raw = JSON.parse(readFileSync(MAP_PATH, "utf8")) as Record<
    string,
    string
  >;
  const entries = Object.entries(raw).filter(
    ([k, v]) => !k.startsWith("_") && typeof v === "string" && v.trim() !== ""
  );

  if (entries.length === 0) {
    console.error(
      `No populated entries in ${MAP_PATH}. Add "Title": "https://soundcloud.com/..." pairs, then re-run.`
    );
    process.exit(1);
  }

  // Build a case-insensitive lookup of DB titles so minor casing differences
  // in the map still resolve, while surfacing genuine title mismatches.
  const dbTitles = await fetchTranscriptTitles();
  const byLower = new Map<string, string>();
  for (const t of dbTitles) byLower.set(t.toLowerCase(), t);

  const matched: { title: string; url: string }[] = [];
  const unmatched: string[] = [];
  for (const [title, url] of entries) {
    const canonical = byLower.get(title.toLowerCase());
    if (canonical) matched.push({ title: canonical, url });
    else unmatched.push(title);
  }

  if (unmatched.length > 0) {
    console.warn(
      `\n⚠  ${unmatched.length} title(s) in ${MAP_PATH} did not match any transcript. Fix these (run --list to see valid titles):`
    );
    for (const t of unmatched) console.warn(`     ${t}`);
  }

  console.log(
    `\n${dryRun ? "[dry-run] Would update" : "Updating"} ${matched.length} document(s):`
  );
  for (const { title, url } of matched) console.log(`  ${title}\n    -> ${url}`);

  if (dryRun) {
    console.log("\n[dry-run] No changes written.");
    return;
  }

  let updated = 0;
  for (const { title, url } of matched) {
    const { error } = await supabase
      .from("documents")
      .update({ soundcloud_url: url })
      .eq("source", "transcript")
      .eq("title", title);
    if (error) {
      console.error(`  Error updating "${title}":`, error.message);
      continue;
    }
    updated++;
  }

  console.log(
    `\nDone. Updated ${updated}/${matched.length} document(s) with SoundCloud URLs.`
  );
}

main();
