import { readFileSync, writeFileSync } from "fs";

const BASE =
  "benchmark";
const queries = JSON.parse(readFileSync(`${BASE}/benchmark.json`, "utf8"));

// Optional output path so a new retrieval configuration can be scored without
// overwriting a committed baseline: npx tsx benchmark/run_rag.ts out.json
const OUT = process.argv[2] ?? `${BASE}/rag_results.json`;

async function main() {
  const { searchByContent } = await import(
    "../src/lib/retrieval"
  );
  const out: any[] = [];
  for (const item of queries) {
    const results = await searchByContent(item.query);
    // rank distinct documents in retrieval order
    const docs: string[] = [];
    for (const r of results as any[]) {
      const t = r.document_title ?? r.title ?? "?";
      if (!docs.includes(t)) docs.push(t);
    }
    out.push({ query: item.query, docs });
    console.log(`${item.query} => ${docs.slice(0, 3).join(" | ")}`);
  }
  writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(`done -> ${OUT}`);
}

main().catch((e) => {
  console.error("ERR", e);
  process.exit(1);
});
