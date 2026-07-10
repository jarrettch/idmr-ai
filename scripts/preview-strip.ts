import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";
import { stripBoilerplate } from "./strip-boilerplate";

const RAW_DIR = join(process.cwd(), "data", "raw");
const OUT = process.argv[2] ?? "/tmp/strip-report.txt";

const files = readdirSync(RAW_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort();

let report = `STRIP PREVIEW — ${files.length} transcripts\n`;
let totalRemovedChars = 0;
const flagged: string[] = [];

for (const file of files) {
  const obj = JSON.parse(readFileSync(join(RAW_DIR, file), "utf-8"));
  const before = obj.content ?? "";
  const { cleaned, removed } = stripBoilerplate(before);
  const removedChars = before.length - cleaned.length;
  totalRemovedChars += removedChars;

  // Flag anomalies for human review:
  //  - stripped a lot (possible over-strip)
  //  - stripped nothing (possible missed boilerplate)
  //  - convention text survived (e.g. a preamble longer than the anchor bound)
  const pct = before.length ? Math.round((100 * removedChars) / before.length) : 0;
  if (removedChars > 2500) flagged.push(`${file} — removed ${removedChars} chars (${pct}%)`);
  if (removed.length === 0) flagged.push(`${file} — removed NOTHING`);
  const survivor = cleaned.match(
    /indicates an inaudible|indicates that dr\.?\s*kinley ended|words in capital letters are comments|pause words[, ]+such as|(?:transcriber|proofreader)['‘’s ]*notes|(?:audience|student body) comments are/i
  );
  if (survivor) {
    const at = survivor.index ?? 0;
    flagged.push(
      `${file} — convention text SURVIVES strip @${at}: "${cleaned.slice(at, at + 80)}"`
    );
  }

  report += `\n${"=".repeat(78)}\n${file}\n`;
  report += `title: ${obj.title}\n`;
  report += `before ${before.length} → after ${cleaned.length} chars (removed ${removedChars}, ${pct}%), ${removed.length} lines\n`;
  report += `--- REMOVED LINES ---\n`;
  report += removed.map((l) => `  ✗ ${l.trim()}`).join("\n") || "  (none)";
  report += `\n--- KEPT: first 260 chars of cleaned body ---\n`;
  report += "  " + cleaned.slice(0, 260).replace(/\n+/g, " ⏎ ") + "\n";
}

report =
  `SUMMARY\n` +
  `  files: ${files.length}\n` +
  `  total removed: ${totalRemovedChars} chars\n` +
  `  flagged for review: ${flagged.length}\n` +
  flagged.map((f) => `    ! ${f}`).join("\n") +
  `\n\n` +
  report;

writeFileSync(OUT, report);
console.log(`Wrote ${OUT}`);
console.log(`Total removed: ${totalRemovedChars} chars across ${files.length} files`);
console.log(`Flagged for review: ${flagged.length}`);
for (const f of flagged) console.log(`  ! ${f}`);
