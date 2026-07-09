import { DOCUMENT_ALIASES } from "./document-aliases";

// Resolves a loose user reference to a transcript — by content heading
// ("Sunday Morning 74/75"), "also called" name ("the Christmas tape"), date,
// or partial/exact title — back to the canonical documents.title. Uses trigram
// containment (how much of the query appears in a title/alias), which tolerates
// the query being far shorter than the alias it matches.

// Meta/filler + common stopwords that show up in references but shouldn't
// drive matching (stripped from the query only, so they can't skew trigram
// containment toward documents that happen to contain "the"/"of"/etc).
const QUERY_FILLER = new Set([
  "summarize", "summary", "transcript", "transcripts", "lecture", "lectures",
  "talk", "overview", "please", "tell", "give", "about",
  "the", "a", "an", "of", "in", "on", "and", "to", "for", "with", "that",
  "this", "it", "is", "was", "his", "he",
]);

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeQuery(s: string): string {
  return normalize(s)
    .split(" ")
    .filter((w) => w && !QUERY_FILLER.has(w))
    .join(" ");
}

function trigrams(normalized: string): Set<string> {
  const grams = new Set<string>();
  if (normalized.length < 2) return grams;
  const padded = `  ${normalized} `;
  for (let i = 0; i < padded.length - 2; i++) grams.add(padded.slice(i, i + 3));
  return grams;
}

function containment(query: Set<string>, field: Set<string>): number {
  if (query.size === 0) return 0;
  let hits = 0;
  for (const g of query) if (field.has(g)) hits++;
  return hits / query.size;
}

// Precompute normalized forms + trigram sets for every title/alias once.
interface IndexedField {
  norm: string;
  grams: Set<string>;
}
interface IndexedDoc {
  title: string;
  fields: IndexedField[];
  union: Set<string>; // all fields' trigrams, for cross-field references
}

const INDEX: IndexedDoc[] = DOCUMENT_ALIASES.map((d) => {
  const fields = [d.title, ...d.aliases].map((f) => {
    const norm = normalize(f);
    return { norm, grams: trigrams(norm) };
  });
  const union = new Set<string>();
  for (const f of fields) for (const g of f.grams) union.add(g);
  return { title: d.title, fields, union };
});

/**
 * Best-matching canonical title for `ref`, or null if nothing clears
 * `threshold`. Threshold is the fraction of the query's trigrams that must
 * appear in the winning title/alias.
 */
export function resolveDocumentTitle(
  ref: string,
  threshold = 0.6
): string | null {
  const qNorm = normalizeQuery(ref);
  const qGrams = trigrams(qNorm);
  if (qGrams.size === 0) return null;

  let bestTitle: string | null = null;
  let bestScore = 0;

  for (const doc of INDEX) {
    // Cross-field: how much of the query appears anywhere in this doc's
    // title+aliases (catches "debate with RN Hogan" where "debate" is in the
    // title and "RN Hogan" in a separate alias). Slightly discounted so a
    // clean single-field match still wins ties.
    let score = containment(qGrams, doc.union) * 0.9;

    for (const field of doc.fields) {
      let s = containment(qGrams, field.grams);
      // Strong boost for a clean substring match either direction (guarded
      // against trivially short queries).
      if (
        qNorm.length >= 5 &&
        (field.norm.includes(qNorm) || qNorm.includes(field.norm))
      ) {
        s = Math.max(s, 0.95);
      }
      if (s > score) score = s;
    }
    if (score > bestScore) {
      bestScore = score;
      bestTitle = doc.title;
    }
  }

  return bestScore >= threshold ? bestTitle : null;
}
