# Search benchmark
Run from repo root:
1. python3 benchmark/run_old_search.py
2. set -a && source .env.local && set +a && npx tsx benchmark/run_rag.ts
3. python3 benchmark/score.py
See specs/SEARCH-BENCHMARK-2026-07-29.md for results + analysis.
