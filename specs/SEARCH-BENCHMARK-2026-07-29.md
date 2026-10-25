# Search Benchmark: idmr.net keyword search vs idmr-ai semantic retrieval

**Date:** 2026-07-29
**Method:** 30 queries in three buckets (exact-title lookups, paraphrase/typo, conceptual questions), ground-truth lecture(s) labeled per query from the 99-document corpus. Both systems queried programmatically; scored on whether any ground-truth document appears in the **top 3 distinct results**.

- **Old system:** idmr.net Echo Knowledge Base search (`admin-ajax.php`, action `epkb-search-kb`) — the search bar on idmr.net/transcripts.
- **New system:** `searchByContent()` from `src/lib/retrieval.ts` — raw pgvector semantic similarity, **without** the app's agent layer (no `search_by_title`, no `search_within_document`, no LLM tool choice).

## Results (top-3 hit rate)

| Bucket | Old keyword search | Raw semantic retrieval |
|---|---|---|
| A: exact-title lookups | **10/10** | 9/10 |
| B: paraphrase/typo | 7/10 | 7/10 |
| C: conceptual questions | 8/10 | 7/10 |
| **Total** | **25/30** | **23/30** |

## Headline findings

1. **Raw vector similarity alone does NOT beat keyword search on this corpus.** The lecture vocabulary is highly distinctive (Elohim, carnal mind, Aaron's rod…), so exact-word matching performs well when the words are present. This is the argument for **hybrid retrieval**, not embeddings-only.

2. **Failure modes are complementary:**
   - Keyword search returns **zero results** on misspellings/apostrophe variants: `aarons rod` → 0, `milennium` → 0. Semantic retrieval nailed both (2/2 vs 0/2). It also missed `hebrews 1:1 explained` (the "Explanation of Hebrews 1:1" lecture never surfaced) and `what happens after death`.
   - Semantic retrieval's misses are mostly **textbook crowding**: chunks of *Elohim the Archetype* (the largest document) dominate cosine similarity and push the correct lecture out of the top 3 (`how to enter the most holy place`, `satan let loose in the flesh`, `Day of the Lord`, `psalm 139 sunrise`, `666 in the garden`, `what did dr kinley see in his vision`).

3. **Result-list burden:** the old search returns a **mean of 36 / median 28.5 articles per query (max 91)** with no semantic ranking below the exact matches — the member's work has just begun. The app returns targeted passages and (via chat) a cited answer.

4. **This benchmark handicaps the app.** Production is an agent with three retrieval tools; `search_by_title` would trivially win bucket A and much of B. A fair *product-level* benchmark drives the chat endpoint end-to-end and scores "did the member get a correct, cited answer" — expected to be strongly in the app's favor, at the cost of a few dollars of API tokens to run.

## Implementation status

**2026-10-25:** roadmap items 1-3 are implemented together in
`match_chunks_hybrid` (`supabase/schema.sql`): reciprocal rank fusion over a
vector list, a `to_tsvector`/`ts_rank_cd` list, and a trigram title list, with
a `row_number()` per-document cap over the fused set. `searchByContent` calls
it and falls back to `match_chunks` when the function is absent. Item 2 is done
at *query* time via title similarity rather than by prepending titles at embed
time, so it needed no re-chunk or re-embed.

The DDL is unapplied and the benchmark is not yet re-run, so **no post-change
numbers exist**. Until they do, the 23/30 above remains the current measured
state. Item 4 (re-run after each change) is the next step; see
`benchmark/README.md` for scoring against the frozen baseline.

## Engineering roadmap (from failure analysis)

1. **Hybrid retrieval** — combine vector similarity with keyword/BM25 (or Postgres full-text) scores; exact-phrase matches should boost.
2. **Title-aware scoring** — boost chunks whose `document_title` matches query terms (would fix most bucket-A/B misses; e.g. prepend title to chunk text at embedding time, or add a title-similarity term at query time).
3. **Per-document diversity cap** — limit any single document (the textbook) to N chunks in top-k, or apply MMR, so one large document can't crowd out the rest of the corpus.
4. **Re-run this benchmark after each change** — files: `benchmark.json` (queries + ground truth), `run_old_search.py`, `run_rag.ts`, `score.py`.

## Talking points (IDMR website consult)

- The current site search silently returns **nothing** for a missing apostrophe or a one-letter typo, and up to 91 unranked articles otherwise.
- The AI app answers topic questions with citations; benchmark + roadmap above shows the retrieval layer is being measured and systematically improved — not vibes.

## Claims safe to make publicly (each backed by this data)

- "Benchmarked retrieval against the legacy keyword search on a 30-query labeled set; built a hybrid-retrieval roadmap from the failure analysis."
- "Legacy search returned zero results for misspelled queries; semantic retrieval recovered the correct source in 100% of those cases."
- **Not** safe: any blanket "X% better than the old search" — raw retrieval parity is the honest current state.
