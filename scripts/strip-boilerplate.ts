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

import { findCatalogCredits } from "./catalog-grammar";

// Each entry removes one class of boilerplate. Optional leading "N." absorbs
// the numbered-list prefix so no orphan "1." / "5." is left behind.
const N = String.raw`(?:\d+[.)]\s*)?`;

// Content-eating patterns match the full normalized document, but only
// complete spans ending within PREAMBLE_CHARS are removed. Thus a sermon
// sentence that happens to echo their wording ("a catalog of the sins",
// "…40 minutes audio cassettes could not hold…") can never be eaten, and
// mid-body markers like "(END OF THE ORIGINAL 1ST 120 MINUTE AUDIO CASSETTE
// SIDE 2)" stay intact. Validated across all 99 raw files: the deepest real
// preamble boilerplate ends at normalized offset 1,723. If a future
// transcript's notes run past this bound, preview-strip flags the survivors.
export const PREAMBLE_CHARS = 2500;

interface PatternDefinition {
  label: string;
  source: string;
  flags: string;
  audit: "error" | "scoped";
}

// Sources, rather than shared stateful RegExp objects, let the stripper and
// survivor audit instantiate the exact same grammar safely.
export const PREAMBLE_PATTERN_DEFINITIONS: PatternDefinition[] = [
  // Convention: "… indicates that Dr. Kinley ended a word / the sentence …
  // without verbally completing it." The debate says "the speaker".
  {
    label: "ended-word convention",
    source:
      N +
      String.raw`…*\s*indicates that (?:dr\.?\s*kinley|the speaker) ended[^.]{0,120}?completing it\.?`,
    flags: "gi",
    audit: "error",
  },

  // Convention: "___ indicates an inaudible word or syllable."
  {
    label: "inaudible convention",
    source: N + String.raw`_*\s*indicates an inaudible word or syllable\.?`,
    flags: "gi",
    audit: "error",
  },

  // Convention: "WORDS IN CAPITAL LETTERS are comments of the transcriber."
  // ("of the transcriber" optional — some files truncate it before "NOTES".)
  {
    label: "capital-letters convention",
    source:
      N +
      String.raw`words in capital letters are comments(?:\s+of the transcriber)?\.?`,
    flags: "gi",
    audit: "error",
  },

  // Convention: "Audience/Student Body comments are (only) included if …" /
  // "… are left out …" — many phrasings, multi-clause, with embedded "Dr."
  // periods and a doubled "person". Rather than anchor on the sentence's own
  // words, consume from "comments" up to the next structural marker (next
  // numbered note, a scripture/tape header, the body's speaker turn, etc.).
  {
    label: "audience-comments convention",
    source:
      N +
      String.raw`(?:audience|student body) comments[\s\S]{0,340}?(?=\s*(?:\d+[.)]\s|scripture\b|tape\s|side\s|dr\.?\s*kinley\s*:|reader\s*:|previous speaker|proofread|approved by|catalog|notes\b|table of contents|page\s*:|$))`,
    flags: "gi",
    audit: "error",
  },

  {
    label: "group-comments convention",
    source:
      N +
      String.raw`group comments and general conversation has not been transcribed[\s\S]{0,220}?(?:\.\)|\.)`,
    flags: "gi",
    audit: "error",
  },

  {
    label: "audience-responses convention",
    source:
      N +
      String.raw`audience responses are only included if more than one person responded\.?`,
    flags: "gi",
    audit: "error",
  },

  // Convention (two phrasings): "pause words have been left out of the
  // transcript … (ah, see, …)" and "Pause words, such as: … were left out of
  // the transcription unless emphasized …."
  {
    label: "pause-words convention",
    source:
      N +
      String.raw`(?:unless emphasized by dr\.?\s*kinley[,\s]*)?pause words have been left out of the transcript[^).]{0,400}?[).]`,
    flags: "gi",
    audit: "error",
  },
  {
    label: "pause-words-such-as convention",
    source:
      N +
      String.raw`pause words,?\s*such as[\s\S]{0,300}?left out of the transcription[\s\S]{0,160}?\.`,
    flags: "gi",
    audit: "error",
  },
  {
    label: "words-such-as convention",
    source:
      N +
      String.raw`words such as[\s\S]{0,300}?were left out[\s\S]{0,160}?\.`,
    flags: "gi",
    audit: "error",
  },
  {
    label: "all-words-transcribed convention",
    source:
      N +
      String.raw`all words of both speakers have been transcribed[\s\S]{0,260}?(?:both speakers\.)`,
    flags: "gi",
    audit: "error",
  },
  {
    label: "capitals-explain-noises convention",
    source:
      N +
      String.raw`\(\s*capitals?\s+letters\s*\)\s*explains? noises in the background\.?`,
    flags: "gi",
    audit: "error",
  },
  {
    label: "incomplete-word convention",
    source:
      N +
      String.raw`…*\s*means that the word or sentence was not completed\.?`,
    flags: "gi",
    audit: "error",
  },

  // Notes-block header ("TRANSCRIBER'S NOTES", "PROOFREADERS' NOTES", either
  // apostrophe style; the word "NOTE(S)" may be absent after a wrapped header).
  {
    label: "notes header",
    source: String.raw`(?:transcriber|proofreader)['‘’s ]*notes?\b\s*[:.]?`,
    flags: "gi",
    audit: "error",
  },

  // Cassette credits (well-bounded values only).
  {
    label: "cassette credit",
    source:
      String.raw`\b\d+\s+\d+\s+minutes?\s+(?:audio\s+)?cassettes?(?:\s+tape)?`,
    flags: "gi",
    audit: "scoped",
  },
  {
    label: "cassette credit",
    source: String.raw`\b\d+\s+minutes?\s+(?:audio\s+)?cassettes?`,
    flags: "gi",
    audit: "scoped",
  },
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

interface Span {
  start: number;
  end: number;
  label: string;
}

export interface BoilerplateSurvivor extends Span {
  severity: "error" | "review";
  excerpt: string;
}

function patternFor(definition: PatternDefinition): RegExp {
  return new RegExp(definition.source, definition.flags);
}

function collectPatternSpans(
  text: string,
  definitions: PatternDefinition[],
  maxEnd?: number
): Span[] {
  const spans: Span[] = [];
  for (const definition of definitions) {
    for (const match of text.matchAll(patternFor(definition))) {
      if (match.index === undefined || match[0].length === 0) continue;
      const end = match.index + match[0].length;
      if (maxEnd !== undefined && end > maxEnd) continue;
      spans.push({ start: match.index, end, label: definition.label });
    }
  }
  return spans;
}

function removeSpans(
  text: string,
  spans: Span[]
): { text: string; removed: string[] } {
  const ordered = [...spans].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Span[] = [];
  for (const span of ordered) {
    const previous = merged[merged.length - 1];
    if (previous && span.start <= previous.end) {
      previous.end = Math.max(previous.end, span.end);
      previous.label = `${previous.label}, ${span.label}`;
    } else {
      merged.push({ ...span });
    }
  }

  const removed = merged.map((span) => text.slice(span.start, span.end).trim());
  let result = "";
  let cursor = 0;
  for (const span of merged) {
    result += text.slice(cursor, span.start) + " ";
    cursor = span.end;
  }
  result += text.slice(cursor);
  return { text: result, removed: removed.filter(Boolean) };
}

/**
 * Re-run the shared grammar over the full cleaned body. Convention sentences
 * are always errors; catalog/cassette-shaped text outside the removal region
 * is reported for review because mid-body recording markers are intentional.
 */
export function findBoilerplateSurvivors(
  cleaned: string
): BoilerplateSurvivor[] {
  const survivors: BoilerplateSurvivor[] = [];

  for (const definition of PREAMBLE_PATTERN_DEFINITIONS) {
    for (const match of cleaned.matchAll(patternFor(definition))) {
      if (match.index === undefined || match[0].length === 0) continue;
      const end = match.index + match[0].length;
      survivors.push({
        start: match.index,
        end,
        label: definition.label,
        severity:
          definition.audit === "error" || end <= PREAMBLE_CHARS
            ? "error"
            : "review",
        excerpt: cleaned.slice(
          Math.max(0, match.index - 100),
          Math.min(cleaned.length, end + 100)
        ),
      });
    }
  }

  for (const credit of findCatalogCredits(cleaned)) {
    survivors.push({
      start: credit.start,
      end: credit.end,
      label: "catalog credit",
      severity: credit.end <= PREAMBLE_CHARS ? "error" : "review",
      excerpt: cleaned.slice(
        Math.max(0, credit.start - 100),
        Math.min(cleaned.length, credit.end + 100)
      ),
    });
  }

  return survivors.sort((a, b) => a.start - b.start);
}

export function stripBoilerplate(content: string): StripResult {
  // Normalize whitespace so wrapping can't hide a pattern.
  let text = content.replace(/\s+/g, " ").trim();

  // Match against the full document so `$` means the real end of the document,
  // not an artificial slice boundary. Remove only spans whose complete match
  // ends inside the validated preamble region.
  const preambleSpans = collectPatternSpans(
    text,
    PREAMBLE_PATTERN_DEFINITIONS,
    PREAMBLE_CHARS
  );
  for (const credit of findCatalogCredits(text)) {
    if (credit.end <= PREAMBLE_CHARS) {
      preambleSpans.push({
        start: credit.start,
        end: credit.end,
        label: "catalog credit",
      });
    }
  }
  const preambleResult = removeSpans(text, preambleSpans);
  text = preambleResult.text;

  const globalDefinitions: PatternDefinition[] = GLOBAL_PATTERNS.map(
    (pattern, index) => ({
      label: `global scaffolding ${index + 1}`,
      source: pattern.source,
      flags: pattern.flags,
      audit: "scoped",
    })
  );
  const globalResult = removeSpans(
    text,
    collectPatternSpans(text, globalDefinitions)
  );
  text = globalResult.text;
  const removed = [...preambleResult.removed, ...globalResult.removed];

  // Tidy the seams left by removals.
  const cleaned = text
    .replace(/\s+([.,;:)])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();

  return { cleaned, removed };
}
