import { resolveDocumentTitle } from "../src/lib/resolve-document";

// Regression check for the document-reference resolver. Run: npm run test:resolve
// Each case: [reference, expected substring of the resolved title | null].
const CASES: [string, string | null][] = [
  // Content-heading references (the original bug: catalog title differs).
  ["Sunday Morning in 74/75", "Truth Through"],
  ["summarize the Sunday Morning in 74/75 transcript", "Truth Through"],
  // "also called" alternate names.
  ["the Christmas tape", "Carnal Mind Defined"],
  ["Come on up John", "Come Out of Babylon"],
  ["1969 Xmas", "Yahweh-Elohim is the First Adam"],
  // Exact / partial titles.
  ["carnal mind defined", "Carnal Mind Defined"],
  ["carnal mind", "Carnal Mind Defined"],
  ["Here I Am", "Here I Am"],
  ["day of the lord", "Day of the Lord"],
  ["come out of babylon", "Come Out of Babylon"],
  ["satanic spirits", "Satanic Spirits"],
  // Cross-field (title + disputants alias) and textbook.
  ["debate with church of christ", "Debate with the Church"],
  ["the debate with RN Hogan", "Debate with the Church"],
  ["the archetype", "Elohim the Archetype"],
  // Off-topic queries must NOT force a match.
  ["what is the meaning of life", null],
  ["tell me about quantum physics", null],
  ["who is jesus", null],
];

let failed = 0;
for (const [ref, want] of CASES) {
  const got = resolveDocumentTitle(ref);
  const ok = want === null ? got === null : got !== null && got.includes(want);
  if (!ok) {
    failed++;
    console.error(`✗ ${JSON.stringify(ref)} -> ${got}  (expected ${want})`);
  }
}

if (failed === 0) {
  console.log(`✓ resolver: all ${CASES.length} cases pass`);
} else {
  console.error(`\n${failed}/${CASES.length} cases FAILED`);
  process.exit(1);
}
