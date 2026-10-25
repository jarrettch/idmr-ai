# Search benchmark

Scores the app's retrieval against the legacy idmr.net keyword search on 30
labeled queries. See `specs/SEARCH-BENCHMARK-2026-07-29.md` for results and
analysis.

Run from repo root:

1. `python3 benchmark/run_old_search.py`
2. `set -a && source .env.local && set +a && npx tsx benchmark/run_rag.ts`
3. `python3 benchmark/score.py`

Step 1 only needs re-running if the legacy site changes; `old_results.json` is
committed.

## Comparing a retrieval change

Both scripts take an optional path so a new configuration can be scored
without overwriting the committed baseline in `rag_results.json`:

```
npx tsx benchmark/run_rag.ts benchmark/rag_hybrid_results.json
python3 benchmark/score.py benchmark/rag_hybrid_results.json   # new
python3 benchmark/score.py                                     # baseline
```

`rag_results.json` is the frozen 23/30 raw-vector baseline from 2026-07-29.
Keep it that way so later changes stay comparable.
