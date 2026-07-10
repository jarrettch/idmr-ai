// Removes transcription boilerplate from a raw transcript before chunking:
// the transcriber's/proofreader's convention notes, plus catalog / cassette /
// scaffolding cruft.
//
// Strategy: normalize whitespace FIRST (the raw files hard-wrap mid-phrase and
// mid-word, which defeats line-based matching), then remove the *specific*
// boilerplate sentences by pattern. Two layers keep sermon text safe: each
// pattern matches exact convention wording AND the content-eating patterns are
// confined to the transcriber's preamble (only body-recurring scaffolding runs
// globally). That makes under-stripping (a stray credit left behind) the worst
// case, never over-stripping (losing sermon text) — and preview-strip flags
// any convention text that survives.
//
// PRESERVED on purpose: title/heading, DISPUTANTS, PRESENT ON TAPE,
// SPEAKER/READER roles, SUBJECT, location, occasion, and "PLEASE NOTE"
// provenance — all real retrieval context.

// Each entry removes one class of boilerplate. Optional leading "N." absorbs
// the numbered-list prefix so no orphan "1." / "5." is left behind.
const N = String.raw`(?:\d+[.)]\s*)?`;

// Content-eating patterns run only against the transcriber's preamble — the
// first PREAMBLE_CHARS of the whitespace-normalized text — so a sermon
// sentence that happens to echo their wording ("a catalog of the sins",
// "…40 minutes audio cassettes could not hold…") can never be eaten, and
// mid-body markers like "(END OF THE ORIGINAL 1ST 120 MINUTE AUDIO CASSETTE
// SIDE 2)" stay intact. Validated across all 99 raw files: the deepest real
// preamble boilerplate ends at normalized offset 1,723. If a future
// transcript's notes run past this bound, preview-strip flags the survivors.
const PREAMBLE_CHARS = 2500;

// Order matters: the specific convention SENTENCES run before the notes-block
// header, so a trailing "transcriber" can't be nibbled off by the header
// pattern ("transcriber NOTES") before its own sentence matches.
const PREAMBLE_PATTERNS: RegExp[] = [
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

  // Catalog credit. The value must be DIGIT-LED — every real catalog value is
  // ("74 TV", "73.1225", "66-68 I") — so prose like "a catalog of the sins"
  // never matches. The label's case variants are spelled out because the
  // 1–4-letter suffix ("TV", "HSGC") must stay case-SENSITIVE: under an /i
  // flag it would swallow any short lowercase word after the value.
  // A trailing "?" marks an uncertain number ("CATALOG #: 65? SSB") — without
  // it the suffix survives as "? SSB" cruft.
  /\b(?:CATALOG|[Cc]atalog)\s*(?:#|(?:NUMBER|[Nn]umber)|(?:NO|[Nn]o)\.?)?\s*[:#]?\s*[0-9][\w.-]*\??(?:\s+[A-Z]{1,4}\b)?/g,

  // Cassette credits (well-bounded values only).
  /\b\d+\s+\d+\s+minutes?\s+(?:audio\s+)?cassettes?(?:\s+tape)?/gi,
  /\b\d+\s+minutes?\s+(?:audio\s+)?cassettes?/gi,
];

// Scaffolding recurs through the BODY as per-page footers (up to 14
// "Page: Subject:" fields and 242 underscore rules in one file), so these
// stay global — anchoring them to the preamble would leave dozens behind.
const GLOBAL_PATTERNS: RegExp[] = [
  /(?:notes\s+)?page:\s*subject:/gi,
  /_{3,}/g,
];

export interface StripResult {
  cleaned: string;
  removed: string[]; // matched boilerplate spans, for auditing
}

export function stripBoilerplate(content: string): StripResult {
  // Normalize whitespace so wrapping can't hide a pattern.
  let text = content.replace(/\s+/g, " ").trim();
  const removed: string[] = [];

  const apply = (patterns: RegExp[], s: string): string => {
    for (const re of patterns) {
      for (const m of s.matchAll(re)) {
        const span = m[0].trim();
        if (span) removed.push(span);
      }
      s = s.replace(re, " ");
    }
    return s;
  };

  // Content-eating patterns see only the preamble; scaffolding runs globally.
  const head = apply(PREAMBLE_PATTERNS, text.slice(0, PREAMBLE_CHARS));
  text = apply(GLOBAL_PATTERNS, head + text.slice(PREAMBLE_CHARS));

  // Tidy the seams left by removals.
  const cleaned = text
    .replace(/\s+([.,;:)])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();

  return { cleaned, removed };
}
