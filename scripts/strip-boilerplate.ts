// Removes transcription boilerplate from a raw transcript before chunking:
// the transcriber's/proofreader's convention notes, plus catalog / cassette /
// scaffolding cruft.
//
// Strategy: normalize whitespace FIRST (the raw files hard-wrap mid-phrase and
// mid-word, which defeats line-based matching), then remove the *specific*
// boilerplate sentences by pattern. Because each pattern matches the exact
// convention wording — not a region — it cannot swallow lecture content. That
// makes under-stripping (a stray credit left behind) the worst case, never
// over-stripping (losing sermon text).
//
// PRESERVED on purpose: title/heading, DISPUTANTS, PRESENT ON TAPE,
// SPEAKER/READER roles, SUBJECT, location, occasion, and "PLEASE NOTE"
// provenance — all real retrieval context.

// Each entry removes one class of boilerplate. Optional leading "N." absorbs
// the numbered-list prefix so no orphan "1." / "5." is left behind.
const N = String.raw`(?:\d+[.)]\s*)?`;

// Order matters: the specific convention SENTENCES run before the notes-block
// header, so a trailing "transcriber" can't be nibbled off by the header
// pattern ("transcriber NOTES") before its own sentence matches.
const PATTERNS: RegExp[] = [
  // Convention: "… indicates that Dr. Kinley ended a word / the sentence …
  // without verbally completing it."
  new RegExp(N + String.raw`…*\s*indicates that dr\.?\s*kinley ended[^.]{0,120}?completing it\.?`, "gi"),

  // Convention: "___ indicates an inaudible word or syllable."
  new RegExp(N + String.raw`_*\s*indicates an inaudible word or syllable\.?`, "gi"),

  // Convention: "WORDS IN CAPITAL LETTERS are comments of the transcriber."
  // ("of the transcriber" optional — some files truncate it before "NOTES".)
  new RegExp(N + String.raw`words in capital letters are comments(?:\s+of the transcriber)?\.?`, "gi"),

  // Convention: "Audience/Student Body comments are (only) included if …" /
  // "… are left out …" — many phrasings, multi-clause, with embedded "Dr."
  // periods and a doubled "person". Rather than anchor on the sentence's own
  // words, consume from "comments" up to the next structural marker (next
  // numbered note, a scripture/tape header, the body's speaker turn, etc.).
  new RegExp(
    N +
      String.raw`(?:audience|student body) comments[\s\S]{0,340}?(?=\s*(?:\d+[.)]\s|scripture\b|tape\s|side\s|dr\.?\s*kinley\s*:|reader\s*:|previous speaker|proofread|approved by|catalog|notes\b|table of contents|page\s*:|$))`,
    "gi"
  ),

  // Convention (two phrasings): "pause words have been left out of the
  // transcript … (ah, see, …)" and "Pause words, such as: … were left out of
  // the transcription unless emphasized …."
  new RegExp(N + String.raw`(?:unless emphasized by dr\.?\s*kinley[,\s]*)?pause words have been left out of the transcript[^).]{0,400}?[).]`, "gi"),
  new RegExp(N + String.raw`pause words,?\s*such as[\s\S]{0,300}?left out of the transcription[\s\S]{0,160}?\.`, "gi"),

  // Notes-block header ("TRANSCRIBER'S NOTES", "PROOFREADERS' NOTES", either
  // apostrophe style; the word "NOTE(S)" may be absent after a wrapped header).
  /(?:transcriber|proofreader)['‘’s ]*notes?\b\s*[:.]?/gi,

  // Scaffolding: underscore rules and "Page: Subject:" form fields.
  /(?:notes\s+)?page:\s*subject:/gi,
  /_{3,}/g,

  // Catalog + cassette credits (well-bounded values only).
  /catalog\s*(?:#|number|no\.?)?\s*[:#]?\s*[\w.]+(?:\s+[A-Z]{1,4}\b)?/gi,
  /\b\d+\s+\d+\s+minutes?\s+(?:audio\s+)?cassettes?(?:\s+tape)?/gi,
  /\b\d+\s+minutes?\s+(?:audio\s+)?cassettes?/gi,
];

export interface StripResult {
  cleaned: string;
  removed: string[]; // matched boilerplate spans, for auditing
}

export function stripBoilerplate(content: string): StripResult {
  // Normalize whitespace so wrapping can't hide a pattern.
  let text = content.replace(/\s+/g, " ").trim();
  const removed: string[] = [];

  for (const re of PATTERNS) {
    for (const m of text.matchAll(re)) {
      const span = m[0].trim();
      if (span) removed.push(span);
    }
    text = text.replace(re, " ");
  }

  // Tidy the seams left by removals.
  const cleaned = text
    .replace(/\s+([.,;:)])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();

  return { cleaned, removed };
}
