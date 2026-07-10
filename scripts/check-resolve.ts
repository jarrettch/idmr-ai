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
  // Catalog-number references.
  ["74 TV", "Truth Through"],
  ["catalog 74 TV", "Truth Through"],
  // Short catalog codes resolve via the exact-alias fast path (they'd be
  // unreachable under the min-length guard otherwise).
  ["66CC", "Charts"],
  ["36B", "Satanic Spirits in Ministers"],
  ["catalog 66 H", "You Have to Die"],
  ["65 SSB", "Day of Yahweh"],
  // The uncertain "CATALOG #: 65? SSB" must NOT yield a bare "65" alias that
  // a stray number could exact-match.
  ["65", null],
  // Off-topic queries must NOT force a match.
  ["what is the meaning of life", null],
  ["tell me about quantum physics", null],
  ["who is jesus", null],
  // Short/generic references carry too little signal — must NOT resolve
  // (previously "the tape" scored 1.0 against any alias containing "tape").
  ["the tape", null],
  ["the 1971 lecture", null],
  ["catalog 66", null],
  // Ambiguous references (two docs have "Sunday Morning" aliases) must fall
  // back rather than silently picking one.
  ["the sunday morning tape", null],
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
