import { readFileSync, writeFileSync } from "fs";

const BASE =
  "benchmark";
const queries = JSON.parse(readFileSync(`${BASE}/benchmark.json`, "utf8"));

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
  writeFileSync(`${BASE}/rag_results.json`, JSON.stringify(out, null, 1));
  console.log("done");
}

main().catch((e) => {
  console.error("ERR", e);
  process.exit(1);
});
