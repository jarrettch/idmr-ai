import { resolveDocumentTitle } from "../src/lib/resolve-document";

// Regression check for the document-reference resolver. Run: npm run test:resolve
// Each case: [reference, EXACT canonical documents.title | null]. Exact equality
// only — substring expectations (`includes`) masked wrong-sibling resolutions
// like "satanic spirits" matching any of the three Satanic Spirits titles.
const CASES: [string, string | null][] = [
  // Content-heading references (the original bug: catalog title differs).
  ["Sunday Morning in 74/75", "Truth Through Dr. Kinley's Vision"],
  ["summarize the Sunday Morning in 74/75 transcript", "Truth Through Dr. Kinley's Vision"],
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
  // Exact titles containing filler words ("in", "to") must still hit the
  // exact fast path via the unstripped normalization — the stripped form
  // previously missed the title and the shorter "Satanic Spirits" sibling
  // won the substring boost ("… to Demons" resolved to the wrong document).
  ["satanic spirits in ministers", "Satanic Spirits in Ministers"],
  ["satanic spirits to demons", "Satanic Spirits to Demons"],
  // Punctuation/casing variants of known titles must normalize identically.
  ["Carnal Mind, Defined!", "Carnal Mind Defined"],
  ["HERE-I-AM", "Here I Am"],
  // Cross-field (title + disputants alias) and textbook.
  ["debate with church of christ", "Debate with the Church of Christ"],
  ["the debate with RN Hogan", "Debate with the Church of Christ"],
  ["the archetype", "Elohim the Archetype (Original) Pattern of the Universe"],
  // Catalog-number references.
  ["74 TV", "Truth Through Dr. Kinley's Vision"],
  ["catalog 74 TV", "Truth Through Dr. Kinley's Vision"],
  // Short catalog codes resolve via the exact-alias fast path (they'd be
  // unreachable under the min-length guard otherwise).
  ["66CC", "Charts & the Second Coming"],
  ["36B", "Satanic Spirits in Ministers"],
  ["catalog 66 H", "You Have to Die to Go to Heaven"],
  ["65 SSB", "Day of Yahweh: Spirit, Soul, Body"],
  // The uncertain "CATALOG #: 65? SSB" must NOT yield a bare "65" alias that
  // a stray number could exact-match.
  ["65", null],
  // Year + subject must pick the right document, not one whose tiny catalog
  // alias ("66 h") sits mid-token inside the query ("19[66 h]ell") — the
  // substring boost now requires whole-word boundaries.
  ["the 1966 hell lecture", "Hell: What and Where"],
  // Near-tie tiebreak must keep the tightness of a doc's OWN short title even
  // when its long alias scores marginally higher — previously resolved to the
  // 1973 "Satanic Spirits in Ministers" instead of the June 1971 lecture.
  ["the 1971 satanic spirits lecture", "Satanic Spirits"],
  // Off-topic queries must NOT force a match.
  ["what is the meaning of life", null],
  ["tell me about quantum physics", null],
  ["who is jesus", null],
  // Short/generic references carry too little signal — must NOT resolve
  // (previously "the tape" scored 1.0 against any alias containing "tape").
  ["the tape", null],
  ["the 1971 lecture", null],
  ["catalog 66", null],
  // Speaker-name references are not document references: the name appears in
  // nearly every title/alias credit line, so it must resolve to nothing
  // rather than to an arbitrary transcript (previously "Dr. Kinley" → the
  // Vision transcript, "Henry Kinley" → the debate).
  ["Dr. Kinley", null],
  ["Henry Kinley", null],
  ["Henry C Kinley", null],
  ["Dr. Henry Clifford Kinley", null],
  // ...but a real title that CONTAINS the speaker's name must still resolve.
  ["truth through dr kinley's vision", "Truth Through Dr. Kinley's Vision"],
  // Ambiguous references (two docs have "Sunday Morning" aliases) must fall
  // back rather than silently picking one.
  ["the sunday morning tape", null],
];

// Pending WS1/WS2 (REVIEW-FIXES-7-15.md): these need the alias-generator
// fixes + regenerated document-aliases.ts before they can pass. Move into
// CASES as each lands.
//   ["67CB", "Come Out of Babylon"],        // 2.1 hard-wrap suffix ("67CB T")
//   ["73 SS", "Satanic Spirits in Ministers"], // 2.3 first-catalog-only
//   ["31A", "Ignorance and Blasphemy"],     // 2.3 first-catalog-only
//   ["71.0213", <its document>],            // 1.2/2.4 en-dash separator

let failed = 0;
for (const [ref, want] of CASES) {
  const got = resolveDocumentTitle(ref);
  if (got !== want) {
    failed++;
    console.error(`✗ ${JSON.stringify(ref)} -> ${JSON.stringify(got)}  (expected ${JSON.stringify(want)})`);
  }
}

if (failed === 0) {
  console.log(`✓ resolver: all ${CASES.length} cases pass`);
} else {
  console.error(`\n${failed}/${CASES.length} cases FAILED`);
  process.exit(1);
}
