import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";
import {
  findBoilerplateSurvivors,
  stripBoilerplate,
} from "./strip-boilerplate";

const RAW_DIR = join(process.cwd(), "data", "raw");
const OUT = process.argv[2] ?? "/tmp/strip-report.txt";

const files = readdirSync(RAW_DIR)
  .filter((f) => f.endsWith(".json"))
  .sort();

let report = `STRIP PREVIEW — ${files.length} transcripts\n`;
let totalRemovedChars = 0;
const flagged: string[] = [];
const fatalSurvivors: string[] = [];

for (const file of files) {
  const obj = JSON.parse(readFileSync(join(RAW_DIR, file), "utf-8"));
  const before = obj.content ?? "";
  const { cleaned, removed } = stripBoilerplate(before);
  const removedChars = before.length - cleaned.length;
  totalRemovedChars += removedChars;

  // Flag anomalies for human review:
  //  - stripped a lot (possible over-strip)
  //  - stripped nothing (possible missed boilerplate)
  //  - shared boilerplate grammar still matches cleaned text
  const pct = before.length ? Math.round((100 * removedChars) / before.length) : 0;
  if (removedChars > 2500) flagged.push(`${file} — removed ${removedChars} chars (${pct}%)`);
  if (removed.length === 0) flagged.push(`${file} — removed NOTHING`);

  const survivors = findBoilerplateSurvivors(cleaned);
  for (const survivor of survivors) {
    const message =
      `${file} — ${survivor.severity.toUpperCase()} survivor ` +
      `${survivor.label} @${survivor.start}: ` +
      `"${survivor.excerpt.replace(/\s+/g, " ")}"`;
    flagged.push(message);
    if (survivor.severity === "error") fatalSurvivors.push(message);
  }

  report += `\n${"=".repeat(78)}\n${file}\n`;
  report += `title: ${obj.title}\n`;
  report += `before ${before.length} → after ${cleaned.length} chars (removed ${removedChars}, ${pct}%), ${removed.length} lines\n`;
  report += `--- REMOVED LINES ---\n`;
  report += removed.map((l) => `  ✗ ${l.trim()}`).join("\n") || "  (none)";
  report += `\n--- KEPT: first 260 chars of cleaned body ---\n`;
  report += "  " + cleaned.slice(0, 260).replace(/\n+/g, " ⏎ ") + "\n";
  if (survivors.length > 0) {
    report += `--- SURVIVOR CONTEXT (full body scanned) ---\n`;
    report += survivors
      .map(
        (survivor) =>
          `  ! ${survivor.severity.toUpperCase()} ${survivor.label} @${survivor.start}: ` +
          survivor.excerpt.replace(/\s+/g, " ")
      )
      .join("\n");
    report += "\n";
  }
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
if (fatalSurvivors.length > 0) {
  console.error(
    `Fatal boilerplate survivors: ${fatalSurvivors.length}; refusing a clean audit.`
  );
  process.exitCode = 1;
}
