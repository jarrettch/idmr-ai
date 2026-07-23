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
  "talk", "overview", "please", "tell", "give", "about", "catalog",
  "the", "a", "an", "of", "in", "on", "and", "to", "for", "with", "that",
  "this", "it", "is", "was", "his", "he",
  // The speaker's name appears in nearly every title/alias (credit lines,
  // "Dr. Henry C. Kinley"), so it carries no signal about WHICH document is
  // meant — "Dr. Kinley" alone must not resolve to some arbitrary transcript.
  "dr", "doctor", "kinley", "henry", "clifford",
]);

// Guards against confidently-wrong matches. Containment is asymmetric by
// design (a short reference can match a long alias), which means a reference
// that filler-strips down to one generic word ("the tape" → "tape",
// "the 1971 lecture" → "1971") scores 1.0 against ANY alias containing it.
// MIN_QUERY_CHARS refuses those outright. AMBIGUITY_MARGIN handles references
// that score high on several documents (two share "Sunday Morning" aliases):
// unless the winner clearly beats the runner-up — or is a decisively TIGHTER
// match (the query covers far more of its alias, e.g. "carnal mind" against
// the title "Carnal Mind Defined" vs. buried inside a long Mystery-of-Iniquity
// title) — we return null so the vector/ILIKE fallback engages instead.
const MIN_QUERY_CHARS = 5;
const AMBIGUITY_MARGIN = 0.15;
const TIGHTNESS_MARGIN = 0.15;

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
  if (qNorm.length === 0) return null;

  // Exact-alias fast path: a reference that IS one of a document's
  // titles/aliases verbatim (normalized) resolves regardless of length —
  // short catalog codes ("66CC", "36B", "66 H") would otherwise be
  // unreachable under MIN_QUERY_CHARS, and exact full-field equality can't
  // substring-collide the way containment can. Checked against the UNSTRIPPED
  // normalization first: filler-stripping removes stopwords that are part of
  // real titles ("Satanic Spirits [in] Ministers", "… [to] Demons"), and the
  // stripped form would miss the exact title and let a shorter sibling title
  // win the substring boost instead. An alias shared by several documents is
  // ambiguous and falls through to the guarded scoring below.
  const rawNorm = normalize(ref);
  for (const candidate of rawNorm === qNorm ? [qNorm] : [rawNorm, qNorm]) {
    const exactMatches = INDEX.filter((doc) =>
      doc.fields.some((f) => f.norm === candidate)
    );
    if (exactMatches.length === 1) return exactMatches[0].title;
  }

  if (qNorm.length < MIN_QUERY_CHARS) return null;
  const qGrams = trigrams(qNorm);
  if (qGrams.size === 0) return null;

  // Score every document: `score` is query-containment (how much of the query
  // appears in the doc's best field or field-union), `tight` is the best
  // reverse containment (how much of a field the query covers) among fields
  // that THEMSELVES clear the threshold — used only to break near-ties in
  // favor of the tightest alias. Keeping tight per-field (rather than taking
  // it from whichever field happens to hold the top score) means a document
  // whose short title matches the query exactly doesn't lose that signal just
  // because a longer alias scores marginally higher; and the union path never
  // contributes a tight value, since a cross-field match has no single field
  // to be "tight" against.
  const scored: { title: string; score: number; tight: number }[] = [];
  const paddedQ = ` ${qNorm} `;

  for (const doc of INDEX) {
    // Cross-field: how much of the query appears anywhere in this doc's
    // title+aliases (catches "debate with RN Hogan" where "debate" is in the
    // title and "RN Hogan" in a separate alias). Slightly discounted so a
    // clean single-field match still wins ties.
    let score = containment(qGrams, doc.union) * 0.9;
    let tight = 0;

    for (const field of doc.fields) {
      let s = containment(qGrams, field.grams);
      // Strong boost for a clean substring match either direction — but only
      // on whole-word boundaries, and never for trivially short queries.
      // Bare .includes() let tiny catalog aliases ride along mid-token:
      // "66 h" sits inside "19[66 h]ell", which resolved "the 1966 hell
      // lecture" to the wrong document.
      if (
        qNorm.length >= MIN_QUERY_CHARS &&
        (` ${field.norm} `.includes(paddedQ) || paddedQ.includes(` ${field.norm} `))
      ) {
        s = Math.max(s, 0.95);
      }
      if (s > score) score = s;
      if (s >= threshold) {
        tight = Math.max(tight, containment(field.grams, qGrams));
      }
    }
    scored.push({ title: doc.title, score, tight });
  }

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score < threshold) return null;

  // Clear winner: nothing else comes close.
  if (best.score - (scored[1]?.score ?? 0) >= AMBIGUITY_MARGIN) {
    return best.title;
  }

  // Near-tie: several documents contain (most of) the query. Resolve only if
  // one candidate is a decisively tighter match than the rest; otherwise the
  // reference is genuinely ambiguous and the fallback search handles it.
  // Contenders must clear the threshold themselves — the tiebreak may pick a
  // runner-up, and "a returned title always scored >= threshold" must hold
  // for whichever contender wins, not just scored[0].
  const contenders = scored.filter(
    (d) => d.score >= threshold && d.score > best.score - AMBIGUITY_MARGIN
  );
  contenders.sort((a, b) => b.tight - a.tight);
  if (contenders[0].tight - (contenders[1]?.tight ?? 0) >= TIGHTNESS_MARGIN) {
    return contenders[0].title;
  }
  return null;
}
