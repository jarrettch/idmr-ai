# Review Fixes — 2026-07-15

Consolidated action plan from two independent reviews of `pipeline-hardening`
(the 8-angle code/process review and the external artifact-level review), each
cross-verified against the other. Every finding below was **confirmed by
execution or direct inspection** — none are speculative.

Reconfirmed 2026-07-23 after revisiting the review prompt: this document is the
consolidated next-step plan for that process/artifact review. It is intentionally
more conservative than the earlier merge-ready pass because it treats the
external review's stronger merge gate as the bar before production re-embed.

Verdict shared by both reviews: nothing needs rollback; the architecture is
sound, but the docs currently claim stronger correctness than the safeguards
establish. Do not merge or run the production re-embed until the merge gate
at the bottom passes.

## Workstreams

WS1+WS2 share the catalog grammar and should land together. WS3 and WS4 can
run in parallel with them. WS5 needs a live Supabase session. WS6 rides along.

---

### WS1 — Stripper & survivor audit (P1 blocker) ✅ DONE 2026-07-23

Before this work, the generated 9,785-chunk artifact **still contained
convention boilerplate** (verified by grep against
`data/processed/chunks.jsonl`), contradicting the "zero convention text
survives" claim in `specs/TODO.md`. The regenerated artifact now contains
9,783 chunks and none of the confirmed convention phrases.

- [x] **1.1 Add missed convention variants to `PREAMBLE_PATTERNS`** (`scripts/strip-boilerplate.ts`):
  - "… indicates that the speaker ended a word or a sentence without verbally completing it" (Debate with the Church of Christ)
  - "Group comments and general conversation has not been transcribed unless it was pertinent…" (Discussion at San Luis Obispo)
  - "Audience responses are only included if more than one person responded" + sibling numbered notes ("… means that the word or sentence was not completed") (Mystery of Iniquity: Satanic Spirit…)
- [x] **1.2 Centralize the catalog grammar** as a shared factory (not one literal regex — extraction needs a capture group + header guard, stripping needs the whole span). Fixes in one place:
  - Missing `(?!\s*:)` header-field guard in the stripper's copy — currently eats "CATALOG NUMBER: 73.1225 **DATE**" leaving an orphaned colon (reproduced on carnal-mind-defined.json).
  - En-dash separator: `CATALOG # – 71.0213` survives stripping AND never becomes an alias (both regexes only accept `:`/`#`).
- [x] **1.3 Fix the `$`-at-truncation over-strip**: the audience-comments pattern's `$` terminator matches the artificial `text.slice(0, 2500)` cut point, silently deleting body text near the boundary (reproduced: 239 chars eaten mid-word). Match against full text and accept only matches whose **entire span ends within** the preamble bound (start-index alone isn't enough — a match starting at 2,499 could still consume 340 chars of body). A real note straddling the bound then goes unstripped and gets flagged by the survivor audit — the right failure mode (visible under-strip, never silent over-strip).
- [x] **1.4 Rebuild the survivor audit** (`scripts/preview-strip.ts`):
  - Derive it from the exported `PREAMBLE_PATTERNS` (re-run them over cleaned text) so it can never drift from the stripper — the current regex is a hand-copied paraphrase missing the catalog/cassette classes entirely.
  - **Pattern-class-aware failure**: convention sentences are survivors anywhere; catalog/cassette matches are only failures in the head region — mid-body cassette markers ("END OF THE ORIGINAL 1ST 120 MINUTE AUDIO CASSETTE SIDE 2") and phrases like "a catalog of the sins" are legitimate body content this branch deliberately preserves. Flag those for review rather than hard-failing.
  - PLUS independent adversarial fixtures containing the currently-missed variants above — shared patterns alone can't detect a variant absent from both lists.
  - PLUS preservation fixtures (over-strip regressions): mid-body cassette markers, "a catalog of the sins", `DATE:` header fields, and text straddling the 2,500 boundary.
  - **Exit nonzero on survivor findings** (currently always exits 0; 19 flags went unnoticed).
  - Scan the full cleaned body, not just the first 260 chars — but report bounded context around matches, not full transcripts.

### WS2 — Alias generation (P1, lands with WS1) ✅ DONE 2026-07-23

- [x] **2.1 Fix hard-wrap suffix capture** in `extractCatalog` (`scripts/build-aliases.ts`): the optional `[A-Z]{1,4}` suffix grabs the severed first letter of a hard-wrapped word → corrupted alias `"67CB T"` (come-out-of-babylon: `Catalog #: 67CB\n\nT\n\nranscribed`), making the real code unresolvable (`resolveDocumentTitle("67cb")` → null, verified).
- [x] **2.2 Decide OCR-corruption policy for `"67.O7l7 P"`** (paul-and-the-eunuchs): NOT the hard-wrap bug — the raw source literally reads `Catalog #: 67.O7l7 P` (the `P` is on the credit line and likely a genuine suffix; the `O`/`l` are OCR-mangled `0`/`1`, probably `67.0717 P`). _Implemented as a reviewed, narrow override that emits canonical `67.0717 P` while retaining the raw OCR form as a fallback alias._
- [x] **2.3 Extract ALL catalog credits, not just the first** (non-global `.match`): dual-numbered transcripts lose a real code — satanic-spirits-in-ministers has GREER `36B` + ROTHSTEIN `73 SS` (only `36B` aliased); ignorance-and-blasphemy has `65.0506` + `31A` (only `65.0506` aliased).
- [x] **2.4** En-dash separator support comes free from the WS1 shared grammar (1.2).
- [x] **2.5 Add generator-level tests**: resolver tests against the committed generated file never exercise the generator itself. Unit-test `extractCatalog`/heading extraction on fixture inputs covering multiple catalog credits, en-dash separators, header-field guards (`DATE:`), uncertainty `?`, and hard-wrapped headers. Add an `aliases:check` script that regenerates and diffs against the committed file (fails on drift).
- [x] **2.6 Regenerate** `src/lib/document-aliases.ts` (`npm run aliases`) and diff-review the alias changes.

### WS3 — Resolver correctness (P1, parallel with WS1/WS2) ✅ DONE 2026-07-23

Three confirmed-by-execution wrong-answer bugs plus the speaker-name gap. All
were invisible to the existing 28 green test cases.

- [x] **3.1 Substring boost must guard field length too** (`src/lib/resolve-document.ts:131`): tiny alias norms boost on incidental containment — `"the 1966 hell lecture"` → *You Have to Die to Go to Heaven* (alias `"66 h"` inside `"19[66 h]ell"`) instead of *Hell: What and Where*. _Fixed: the boost now requires whole-word-boundary containment (space-padded `.includes`) in both directions, which kills mid-token collisions without a length floor that would break legitimate short catalog refs._
- [x] **3.2 Preserve tightness from independently qualified fields** (line 137): `"the 1971 satanic spirits lecture"` → *Satanic Spirits in Ministers* (1973) instead of *Satanic Spirits* (June 1971) because the exact-title tightness was discarded when a long alias scored marginally higher. _Fixed with deliberate document-level aggregation: `score` is the document's best field/union score, while `tight` is the maximum reverse-containment among fields whose own score independently clears the threshold. The cross-field union contributes score only and never manufactures tightness. A stricter per-field candidate-tuple model is deferred unless a reproducible false positive shows this aggregation is too permissive._
- [x] **3.3 Contenders must meet the containment threshold** (line 155): the tightness tiebreak can currently return a runner-up scoring below 0.6 — the "returned title always scored ≥ threshold" invariant is only enforced for `scored[0]`. _Fixed: contenders filter now requires `score >= threshold`._
- [x] **3.4 Speaker-name / generic-token handling**: `"Dr. Kinley"` → *Truth Through Dr. Kinley's Vision*, `"Henry Kinley"`/`"Henry C Kinley"` → *Debate with the Church of Christ* (verified). Add domain filler terms (kinley, henry, dr, …) or require a second discriminative signal. Longer-term option: IDF-weight trigrams and/or strip credit boilerplate from aliases at build time so generic terms carry no signal. _Fixed via filler terms (dr, doctor, kinley, henry, clifford); IDF weighting remains a longer-term option._
- [x] **3.6 (bonus, found while testing) Exact titles containing filler words couldn't hit the exact fast path**: filler-stripping removed "in"/"to" before the exact-alias comparison, so `"satanic spirits in ministers"` → null and `"satanic spirits to demons"` → *Satanic Spirits* (wrong sibling, pre-existing). Fixed by checking the unstripped normalization first in the fast path; both cases added to the suite.
- [x] **3.5 Harden `scripts/check-resolve.ts`** _(done — 44 exact-equality cases pass, including the regenerated catalog aliases from WS1/WS2)_: exact canonical-title expectations (no `includes()`), and add every discovered failure as a regression case:
  - `"the 1966 hell lecture"` → Hell: What and Where
  - `"the 1971 satanic spirits lecture"` → Satanic Spirits
  - `"67CB"` → Come Out of Babylon; `"73 SS"` → Satanic Spirits in Ministers; `"31A"` → Ignorance and Blasphemy; `"71.0213"` → Discussion at San Luis Obispo
  - `"Dr. Kinley"` → null; `"Henry Kinley"` → null; `"Henry C Kinley"` → null
  - Ambiguous refs → null; punctuation variants of known titles

### WS4 — Ops / reproducibility (P2, parallel, do early — tests depend on it) ✅ DONE 2026-07-23

- [x] **4.1 Pin `tsx`** in `devDependencies` (scripts invoke `npx tsx` but tsx is in neither package.json, the lockfile, nor node_modules — every pipeline command depends on an ad-hoc registry download; `test:resolve` hung on a clean machine). _Done: `tsx@4.23.1` exact-pinned in package.json + lockfile; all scripts now invoke bare `tsx` (resolved from node_modules/.bin, no `npx` fetch)._
- [x] **4.2 Add explicit `chunk` and `preview:strip` npm scripts** so today's operational sequence is reproducible. _Done: both verified working (`test:resolve` 39/39 via `npm run`; `preview:strip` writes its report and shows the known pre-WS1 flags)._

### WS5 — Exact-first RPC filtering (P2 blocker, needs live Supabase session)

- [ ] **5.1** `match_chunks_filtered` is the confirmed canonical-path bug: `searchWithinDocument` resolves the reference but passes the canonical title into a `d.title ilike '%…%'` filter, so "Satanic Spirits" pulls chunks from all three sibling titles. Fix with exact-first semantics or a document-id mode. `chunks_by_title` shares the ILIKE pattern but only serves the *unresolved fallback* (resolved `searchByTitle` already bypasses it via `chunksByExactTitle`/document-id) — harden it with the same exact-first CASE, but it's defense-in-depth, not the canonical-path fix. _Implemented locally with case-insensitive exact-first semantics in both RPCs; live regression harness reproduces the pre-deploy failure and awaits deployment._
- [ ] **5.2** Commit + review the `supabase/schema.sql` change **before** deploying, then deploy in the live session — the schema trail must stay accurate. (Carried over from TODO.md "Open" + TODO-AUDIT-7-10 Finding 1.)

### WS6 — Pipeline semantics & cleanup (P2/P3)

- [ ] **6.1 Exclude the junk "Transcripts" doc upstream**: a shared `shouldIncludeDocument()`/manifest consumed by `chunk.ts` AND `build-aliases.ts` (currently a hardcoded title check in build-aliases only; the scraped index page is still chunked, embedded, and reachable via vector search + the ILIKE fallback — verified). Delete its 2 existing chunks + document row during the next live session. _Implemented locally as a shared policy consumed by chunking, embedding, and alias generation; the regenerated artifact contains 9,781 chunks and no junk index chunks. Live row deletion remains._
- [ ] **6.2 Make reconciliation semantics explicit** in `embed.ts`: Step 3 only trims chunk_index tails within (doc, page) groups present in the input — a page dropped/renumbered on re-chunk keeps all its stale rows. Do NOT make plain runs destructive (partial ingestion must stay safe); instead add an explicit `--full-snapshot`/prune mode (or per-document reconcile of `(page, chunk_index)` sets), fix the Step-3 comment to state the real scope, and add a mocked cleanup test.
- [ ] **6.3 (P3, optional ride-along)** `embed.ts` cleanup: reuse `getEmbeddings` from `src/lib/embeddings.ts` (AI SDK `embedMany` with `maxRetries`) or extract one shared `withRetry` helper — the file has three hand-rolled retry loops with three different policies (5×2000ms, 5×1000ms, 3×1000ms), and each sleeps its full backoff after the final attempt before throwing.
- [ ] **6.4 Correct the overclaiming docs**: `specs/TODO.md` line 14 ("confirmed zero convention text survives") and the Step-3 comment in `embed.ts` claim guarantees the code doesn't provide. Update them as their fixes land.

---

## Sequencing

```
Phase A (parallel):
  WS4 (pin tsx first — everything else's tests need it)
  WS1 + WS2 (shared catalog grammar; one PR-sized unit)
  WS3 (resolver + tests)
Phase B (after WS1–WS3 merge locally):
  regenerate aliases (2.6) → npm run test:resolve (expanded suite)
  regenerate chunks → preview:strip must exit 0 with zero fatal survivors
Phase C (live Supabase session, one sitting):
  commit + review exact-first RPC change, then deploy (WS5)
  delete junk Transcripts doc rows (6.1)
  re-embed — using this branch's embed.ts, whose stale-tail cleanup must run
  as part of any shrinking re-embed (it's local script behavior, nothing to
  "deploy"; just don't re-embed from an older script version)
Phase D — smoke tests (merge gate below)
```

## Merge gate

All must pass before merging `pipeline-hardening` / calling this done:

- [x] `preview-strip` exits 0 with zero fatal convention survivors across all 99 files; five intentional mid-body cassette markers remain review-only findings
- [x] Adversarial fixture suite passes (34 checks; known-missed variants caught and preservation cases retained)
- [x] Expanded `test:resolve` passes (44/44) with exact-title assertions
- [x] `npm run build` + Playwright suite still green (7/7)
- [x] Clean-install reproducibility: `npm ci` succeeds normally in the current checkout; afterward all pipeline/test commands run with no undeclared or ad-hoc registry downloads (no bare `npx tsx` fetch)
- [ ] Live smoke tests: the automated pre-deploy harness confirms the original "Sunday Morning in 74/75" query passes, while exact-first filtering, junk-row removal, and four boilerplate checks fail as expected until deploy/re-embed; stale-tail removal must also be verified
- [ ] `.agents/` and `skills-lock.json` NOT swept into the merge

## Finding provenance (for traceability)

| Item | Found by | Confirmed how |
|---|---|---|
| 1.1 survivors in artifact | external review | grep chunks.jsonl |
| 1.2 DATE-swallow / en-dash | both / external | executed stripper; grep artifact |
| 1.3 `$` truncation over-strip | code review | reproduced, 239 chars eaten |
| 1.4 survivor-net drift | both | code inspection |
| 2.1 hard-wrap aliases | code review | executed resolver, null on "67cb" |
| 2.2 OCR-corrupt alias | plan review (2026-07-15) | raw file reads `67.O7l7 P` literally |
| 2.3 first-catalog-only | code review | raw files vs generated aliases |
| 3.1–3.3 resolver scoring | code review | executed, wrong titles returned |
| 3.4 speaker names | external review | executed, reproduced exactly |
| 5.1 ILIKE over-match | external + TODO-AUDIT-7-10 | schema.sql inspection |
| 4.1 tsx unpinned | external review | package.json/lockfile inspection |
| 6.1 junk doc embedded | code review | chunk.ts has no exclusion |
| 6.2 reconcile scope | both | code inspection |
