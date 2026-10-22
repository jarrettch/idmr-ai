import { stripBoilerplate } from "./strip-boilerplate";
import {
  extractCatalogValues,
  findCatalogCredits,
} from "./catalog-grammar";
import { buildTranscriptAliasEntry } from "./build-aliases";
import { chunkTranscript } from "./chunk";
import { shouldIncludeDocument } from "./document-policy";
import { planTailTrims, planFullSnapshot } from "./reconcile";
import { resolveDocumentTitle } from "../src/lib/resolve-document";

interface Check {
  name: string;
  run: () => boolean;
  detail: string;
}

const stripCases: Array<{
  name: string;
  input: string;
  removed: string[];
  preserved: string[];
}> = [
  {
    name: "speaker-ended convention",
    input:
      "TRANSCRIBER'S NOTES 1. … indicates that the speaker ended a word or a sentence without verbally completing it. Dr. Kinley: Body begins.",
    removed: ["the speaker ended a word"],
    preserved: ["Dr. Kinley: Body begins."],
  },
  {
    name: "group-comments convention",
    input:
      "TRANSCRIBER'S NOTES 1. Group comments and general conversation has not been transcribed unless it was pertinent to Dr. Kinley's discourse. Dr. Kinley: Body begins.",
    removed: ["Group comments and general conversation"],
    preserved: ["Dr. Kinley: Body begins."],
  },
  {
    name: "audience-response convention block",
    input:
      "TRANSCRIBER'S NOTES 1. words such as ah, see, you see, were left out for the comprehensibility for the reader. 2. ( CAPITALS LETTERS) explains noises in the background 3. … means that the word or sentence was not completed 4. Audience responses are only included if more than one person responded Dr. Kinley: Body begins.",
    removed: [
      "words such as ah",
      "CAPITALS LETTERS",
      "word or sentence was not completed",
      "Audience responses are only included",
    ],
    preserved: ["Dr. Kinley: Body begins."],
  },
  {
    name: "en-dash catalog separator",
    input: "CATALOG # – 71.0213 Dr. Kinley: Body begins.",
    removed: ["CATALOG"],
    preserved: ["Dr. Kinley: Body begins."],
  },
  {
    name: "catalog stops before header field",
    input: "CATALOG NUMBER: 73.1225 DATE: Christmas Day Dr. Kinley: Body begins.",
    removed: ["CATALOG", "73.1225"],
    preserved: ["DATE: Christmas Day", "Dr. Kinley: Body begins."],
  },
  {
    name: "mid-body catalog prose and cassette marker",
    input:
      `${"Preamble context. ".repeat(180)}Dr. Kinley: a catalog of the sins was described. ` +
      "(END OF THE ORIGINAL 1ST 120 MINUTE AUDIO CASSETTE SIDE 2) Body continues.",
    removed: [],
    preserved: [
      "a catalog of the sins",
      "(END OF THE ORIGINAL 1ST 120 MINUTE AUDIO CASSETTE SIDE 2)",
      "Body continues.",
    ],
  },
  {
    name: "artificial preamble boundary does not terminate a match",
    input:
      `${"x".repeat(2410)} Audience comments are retained in this sermon discussion ` +
      `${"without a structural terminator ".repeat(20)}BODY_SENTINEL`,
    removed: [],
    preserved: ["Audience comments are retained", "BODY_SENTINEL"],
  },
];

const checks: Check[] = [];

for (const testCase of stripCases) {
  const { cleaned } = stripBoilerplate(testCase.input);
  for (const text of testCase.removed) {
    checks.push({
      name: `${testCase.name}: removes ${JSON.stringify(text)}`,
      run: () => !cleaned.includes(text),
      detail: `cleaned=${JSON.stringify(cleaned.slice(0, 500))}`,
    });
  }
  for (const text of testCase.preserved) {
    checks.push({
      name: `${testCase.name}: preserves ${JSON.stringify(text)}`,
      run: () => cleaned.includes(text),
      detail: `cleaned=${JSON.stringify(cleaned.slice(-700))}`,
    });
  }
}

const aliasCases: Array<[string, string]> = [
  ["67CB", "Come Out of Babylon"],
  ["73 SS", "Satanic Spirits in Ministers"],
  ["31A", "Ignorance and Blasphemy"],
  ["71.0213", "Discussion at San Luis Obispo"],
  ["67.0717 P", "Paul and the Eunuchs"],
];

for (const [ref, title] of aliasCases) {
  const actual = resolveDocumentTitle(ref);
  checks.push({
    name: `catalog alias ${JSON.stringify(ref)}`,
    run: () => actual === title,
    detail: `actual=${JSON.stringify(actual)} expected=${JSON.stringify(title)}`,
  });
}

const catalogFixture =
  "GREER CATALOG #: 36B ROTHSTEIN CATALOG #: 73 SS " +
  "CATALOG # – 71.0213 CATALOG #: 65? SSB " +
  "CATALOG NUMBER: 73.1225 DATE: Christmas Day";
const catalogValues = extractCatalogValues(catalogFixture);
for (const expected of ["36B", "73 SS", "71.0213", "65? SSB", "73.1225"]) {
  checks.push({
    name: `catalog parser extracts ${JSON.stringify(expected)}`,
    run: () => catalogValues.includes(expected),
    detail: `values=${JSON.stringify(catalogValues)}`,
  });
}
checks.push({
  name: "catalog parser does not consume DATE header",
  run: () =>
    findCatalogCredits(catalogFixture).every(
      (credit) => !catalogFixture.slice(credit.start, credit.end).includes("DATE")
    ),
  detail: JSON.stringify(findCatalogCredits(catalogFixture)),
});

const hardWrapValues = extractCatalogValues(
  "Catalog #: 67CB T ranscribed by Shannon Brewster"
);
checks.push({
  name: "catalog parser rejects a hard-wrapped header initial as a suffix",
  run: () => hardWrapValues.length === 1 && hardWrapValues[0] === "67CB",
  detail: `values=${JSON.stringify(hardWrapValues)}`,
});

const ocrValues = extractCatalogValues(
  "Catalog #: 67.O7l7 P transcribed by Gerry Rothstein"
);
checks.push({
  name: "catalog parser emits reviewed OCR correction and raw fallback",
  run: () =>
    ocrValues[0] === "67.0717 P" && ocrValues.includes("67.O7l7 P"),
  detail: `values=${JSON.stringify(ocrValues)}`,
});

const generatedFixture = buildTranscriptAliasEntry({
  title: "Fixture Transcript",
  content:
    "A FIXTURE HEADING Catalog #: 11A GREER CATALOG #: 22 BB " +
    "ROTHSTEIN CATALOG #: 33C transcribed by Example",
});
checks.push({
  name: "alias generator keeps every catalog credit",
  run: () =>
    generatedFixture !== null &&
    ["11A", "22 BB", "33C"].every((value) =>
      generatedFixture.aliases.includes(value)
    ),
  detail: `entry=${JSON.stringify(generatedFixture)}`,
});

const excludedTranscript = {
  title: "Transcripts",
  speaker: "",
  date: null,
  url: "https://example.test/transcripts",
  content: "A scraped transcript index, not a lecture.",
};
checks.push({
  name: "shared policy excludes the junk transcript index",
  run: () =>
    !shouldIncludeDocument({
      source: "transcript",
      title: excludedTranscript.title,
    }),
  detail: "Transcripts must be excluded at every generated-data consumer",
});
checks.push({
  name: "chunk generator applies the shared document policy",
  run: () => chunkTranscript(excludedTranscript).length === 0,
  detail: "The excluded transcript index must never enter chunks.jsonl",
});
checks.push({
  name: "alias generator applies the shared document policy",
  run: () => buildTranscriptAliasEntry(excludedTranscript) === null,
  detail: "The excluded transcript index must never enter document-aliases.ts",
});

// --- embed.ts stale-chunk reconciliation (mocked file/DB state) ---
// Mock scenario: doc 1 is paged (textbook-like) and re-chunked with page 2
// dropped and page 1 shrunk from 3 chunks to 2; doc 2 is unpaged and
// unchanged; doc 3 exists only in the DB (absent from the file).
const mockFile = [
  { docId: 1, page: 1, chunkIndex: 0 },
  { docId: 1, page: 1, chunkIndex: 1 },
  { docId: 2, page: null, chunkIndex: 0 },
];
const mockDbChunks = [
  { id: 10, docId: 1, page: 1, chunkIndex: 0 },
  { id: 11, docId: 1, page: 1, chunkIndex: 1 },
  { id: 12, docId: 1, page: 1, chunkIndex: 2 }, // shrunken tail
  { id: 13, docId: 1, page: 2, chunkIndex: 0 }, // dropped page
  { id: 14, docId: 2, page: null, chunkIndex: 0 },
  { id: 15, docId: 3, page: null, chunkIndex: 0 }, // absent doc's chunk
];
const mockDbDocs = [
  { id: 1, source: "textbook", title: "Paged Doc" },
  { id: 2, source: "transcript", title: "Unpaged Doc" },
  { id: 3, source: "transcript", title: "Removed Doc" },
];

const trims = planTailTrims(mockFile);
checks.push({
  name: "default reconcile trims only tails of groups present in the file",
  run: () =>
    trims.length === 2 &&
    trims.some((t) => t.docId === 1 && t.page === 1 && t.maxIdx === 1) &&
    trims.some((t) => t.docId === 2 && t.page === null && t.maxIdx === 0),
  detail: `trims=${JSON.stringify(trims)}`,
});
checks.push({
  name: "default reconcile never targets dropped pages or absent documents",
  run: () => !trims.some((t) => (t.docId === 1 && t.page === 2) || t.docId === 3),
  detail:
    "partial ingestion must stay safe: only (doc, page) groups in the file are trimmed",
});

const snapshot = planFullSnapshot(mockFile, mockDbChunks, mockDbDocs);
checks.push({
  name: "full snapshot deletes dropped-page rows, not just shrunken tails",
  run: () =>
    snapshot.staleChunkIds.includes(12) && snapshot.staleChunkIds.includes(13),
  detail: `staleChunkIds=${JSON.stringify(snapshot.staleChunkIds)}`,
});
checks.push({
  name: "full snapshot keeps every row still present in the file",
  run: () => [10, 11, 14].every((id) => !snapshot.staleChunkIds.includes(id)),
  detail: `staleChunkIds=${JSON.stringify(snapshot.staleChunkIds)}`,
});
checks.push({
  name: "full snapshot deletes exactly the documents absent from the file",
  run: () =>
    snapshot.absentDocs.length === 1 && snapshot.absentDocs[0].id === 3,
  detail: `absentDocs=${JSON.stringify(snapshot.absentDocs)}`,
});
checks.push({
  name: "full snapshot leaves absent-document chunks to the FK cascade",
  run: () => !snapshot.staleChunkIds.includes(15),
  detail:
    "absent docs are deleted as document rows (chunks cascade); their chunks must not double-appear in staleChunkIds",
});

let failed = 0;
for (const check of checks) {
  if (check.run()) continue;
  failed++;
  console.error(`✗ ${check.name}\n  ${check.detail}`);
}

if (failed > 0) {
  console.error(`\n${failed}/${checks.length} pipeline checks FAILED`);
  process.exit(1);
}

console.log(`✓ pipeline: all ${checks.length} checks pass`);
