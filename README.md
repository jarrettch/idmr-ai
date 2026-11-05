# IDMR AI

IDMR AI is a search and chat app for the Institute of Divine Metaphysical Research (IDMR) lecture archive. It uses retrieval-augmented generation (RAG) to answer questions across 98 lecture transcripts and all four volumes of *Elohim the Archetype (Original) Pattern of the Universe*. Answers cite source material and can link to the original transcript and its SoundCloud recording when available.

Ask it to summarize the *Here I Am* lecture, find what the textbook says about the heart, or compare how different lectures discuss a topic. Conversations are saved in the browser so you can return to them later.

## Retrieval results

The benchmark measures whether a labeled source appears in the top three distinct documents for each of 30 queries. See the [benchmark results and analysis](specs/SEARCH-BENCHMARK-2026-07-29.md).

| Search method | Top-3 hits |
| --- | ---: |
| Legacy IDMR keyword search | 25/30 |
| Vector search alone | 23/30 |
| Hybrid retrieval | 30/30 |

Vector search recovered sources for some misspelled queries, but chunks from the much larger textbook often crowded relevant lectures out of the results. The hybrid search combines semantic, keyword, and title matches and limits how many passages a single document can contribute. The same 30 queries informed the final ranking weights.

## How it works

1. **Plan the search.** Claude uses the question and recent conversation to choose among three tools. It can search the full corpus, fetch a document in reading order, or search within a named document. [Chat route](src/app/api/chat/route.ts)
2. **Retrieve passages.** General search combines OpenAI embeddings in pgvector, Postgres full-text search, and trigram title matching with reciprocal rank fusion. Named-document searches can resolve alternate lecture names, dates, and catalog numbers. [Retrieval](src/lib/retrieval.ts) · [Title resolver](src/lib/resolve-document.ts)
3. **Stream the answer.** Claude receives the retrieved passages and their metadata, then streams an answer to the Next.js interface through the Vercel AI SDK. [Chat UI](src/app/page.tsx)

The ingestion scripts strip transcription boilerplate before chunking and embedding the source text. [Ingestion scripts](scripts/)

**Stack** · Next.js, React, TypeScript, Tailwind CSS, Vercel AI SDK, Anthropic, OpenAI, Supabase Postgres with pgvector, Playwright

## Run locally

Use Node.js 22 or newer and install dependencies with `npm ci`. Run the schema in your Supabase project's SQL Editor, then create a `.env.local` file in the repo root. [Database schema](supabase/schema.sql)

```dotenv
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SECRET_KEY=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
```

Keep the Supabase secret and API keys server-side. The raw corpus and database contents are stored separately. To seed your own database, supply transcript JSON files in `data/raw/` with `title`, `speaker`, `date`, `url`, and `content` fields. Put a JSON array of `{ "page": 1, "content": "…" }` objects in `data/pdf_raw/textbook.json`. [Chunking script](scripts/chunk.ts)

```sh
mkdir -p data/processed
npm run chunk
npm run embed -- data/processed/chunks.jsonl
npm run dev
```

Open `http://localhost:3000`.

## Tests and benchmark

These checks run without provider keys or a database. Playwright mocks the chat endpoint to exercise the conversation UI.

```sh
npm run test:resolve
npm run test:pipeline
npx playwright install chromium
npm run test:e2e
```

Score the committed hybrid results with `python3 benchmark/score.py benchmark/rag_hybrid_results.json`. To run retrieval against a populated database, see the [benchmark guide](benchmark/README.md).
