// Shared catalog-credit grammar for transcript stripping and alias generation.
// Callers pass whitespace-normalized text so returned spans use the same
// coordinates as the text they will inspect or edit.

const CATALOG_CREDIT_SOURCE =
  String.raw`\b(?:CATALOG|[Cc]atalog)\s*` +
  String.raw`(?:#|(?:NUMBER|[Nn]umber)|(?:NO|[Nn]o)\.?)?` +
  String.raw`\s*(?:[:#]\s*)?(?:[–—-]\s*)?` +
  String.raw`([0-9][\w.-]*\??)(?:\s+([A-Z]{1,4})\b)?`;

// A wrapped header occasionally becomes "T ranscribed" after whitespace
// normalization. The broad optional suffix sees the isolated "T" as a catalog
// suffix unless we recognize that it completes the following header fragment.
const KNOWN_HEADER_WORDS = new Set([
  "approved",
  "audio",
  "catalog",
  "date",
  "location",
  "notes",
  "printed",
  "proofread",
  "reader",
  "received",
  "recorded",
  "recorder",
  "speaker",
  "subject",
  "tape",
  "transcribed",
  "transferred",
]);

// Reviewed source correction: the transcript is dated July 17, 1967 and its
// raw catalog credit OCRs zero/one as O/l ("67.O7l7 P").
const CATALOG_VALUE_OVERRIDES = new Map([
  ["67.O7l7 P", "67.0717 P"],
]);

export interface CatalogCredit {
  start: number;
  end: number;
  rawValue: string;
  value: string;
}

function isBrokenHeaderSuffix(
  suffix: string,
  textAfterMatch: string
): boolean {
  if (/^\s*:/.test(textAfterMatch)) return true;
  const nextWord = textAfterMatch.match(/^\s+([A-Za-z]+)/)?.[1];
  if (!nextWord) return false;
  return KNOWN_HEADER_WORDS.has(`${suffix}${nextWord}`.toLowerCase());
}

/**
 * Find every catalog credit in whitespace-normalized transcript text.
 */
export function findCatalogCredits(text: string): CatalogCredit[] {
  const pattern = new RegExp(CATALOG_CREDIT_SOURCE, "g");
  const credits: CatalogCredit[] = [];

  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) continue;
    const base = match[1];
    let suffix = match[2] ?? "";
    let end = match.index + match[0].length;

    if (suffix && isBrokenHeaderSuffix(suffix, text.slice(end))) {
      const suffixAt = match[0].lastIndexOf(suffix);
      end = match.index + suffixAt;
      suffix = "";
    }

    const rawValue = `${base}${suffix ? ` ${suffix}` : ""}`;
    credits.push({
      start: match.index,
      end,
      rawValue,
      value: CATALOG_VALUE_OVERRIDES.get(rawValue) ?? rawValue,
    });
  }

  return credits;
}

/**
 * Alias values include the reviewed canonical correction and retain the raw
 * OCR form as a fallback when the two differ.
 */
export function extractCatalogValues(text: string): string[] {
  const values = new Set<string>();
  for (const credit of findCatalogCredits(text)) {
    values.add(credit.value);
    if (credit.rawValue !== credit.value) values.add(credit.rawValue);
  }
  return [...values];
}
