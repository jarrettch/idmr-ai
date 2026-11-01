-- IDMR AI — canonical schema
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- Idempotent: safe to re-run.

-- ============================================================================
-- Extensions
-- ============================================================================

create extension if not exists vector;
create extension if not exists pg_trgm;

-- ============================================================================
-- Tables
-- ============================================================================

-- One row per source document (transcript or textbook).
-- Holds the metadata that used to be duplicated on every chunk row.
create table if not exists documents (
  id              bigserial primary key,
  source          text not null,                  -- 'transcript' | 'textbook'
  title           text not null,
  speaker         text,
  date            text,
  url             text,                           -- idmr.net transcript URL
  soundcloud_url  text,                           -- nullable; populated for the ~10 with audio
  created_at      timestamptz not null default now(),
  unique (source, title)
);

create index if not exists documents_source_idx on documents (source);
create index if not exists documents_title_trgm_idx on documents using gin (title gin_trgm_ops);

-- One row per chunk. References the parent document.
create table if not exists chunks (
  id            bigserial primary key,
  document_id   bigint not null references documents(id) on delete cascade,
  content       text not null,
  page          integer,                          -- textbook only
  chunk_index   integer not null,
  embedding     vector(1536),                     -- text-embedding-3-small
  created_at    timestamptz not null default now(),
  unique nulls not distinct (document_id, chunk_index, page)
);

-- HNSW beats ivfflat on this dataset size — better recall, no `lists` tuning.
create index if not exists chunks_embedding_hnsw_idx
  on chunks using hnsw (embedding vector_cosine_ops);

create index if not exists chunks_document_id_idx on chunks (document_id);

-- Lexical half of hybrid retrieval. An expression index (rather than a stored
-- generated column) keeps this a pure index build with no table rewrite, and
-- stays in sync automatically. Queries must spell the expression identically
-- as to_tsvector('english', content) for the planner to use it.
create index if not exists chunks_content_fts_idx
  on chunks using gin (to_tsvector('english', content));

-- ============================================================================
-- Retrieval RPCs
-- ============================================================================

-- General semantic search across all chunks. Joins documents so callers get
-- title/speaker/date/url/soundcloud_url in a single round trip.
create or replace function match_chunks(
  query_embedding vector(1536),
  match_count     int default 15,
  match_threshold float default 0.15
)
returns table (
  id              bigint,
  content         text,
  source          text,
  title           text,
  speaker         text,
  date            text,
  url             text,
  soundcloud_url  text,
  page            integer,
  chunk_index     integer,
  similarity      float
)
language sql stable as $$
  select
    c.id,
    c.content,
    d.source,
    d.title,
    d.speaker,
    d.date,
    d.url,
    d.soundcloud_url,
    c.page,
    c.chunk_index,
    1 - (c.embedding <=> query_embedding) as similarity
  from chunks c
  join documents d on d.id = c.document_id
  where 1 - (c.embedding <=> query_embedding) > match_threshold
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

-- Hybrid search: the general-purpose replacement for match_chunks.
--
-- The 2026-07-29 benchmark (specs/SEARCH-BENCHMARK-2026-07-29.md) found raw
-- cosine similarity losing 23/30 to the legacy keyword search's 25/30 on
-- top-3 hits, for two reasons: the lecture vocabulary is distinctive enough
-- that exact word matching is strong, and chunks of the corpus's largest
-- document crowded the correct lecture out of top-k. This function addresses
-- both by fusing three ranked lists and then capping per-document output.
--
-- Fusion is reciprocal rank fusion, which consumes only each list's RANK.
-- That sidesteps having to normalise cosine similarity against ts_rank_cd
-- against trigram similarity, none of which share a scale.
--
-- All three weights are 1.0, i.e. plain unweighted RRF. An earlier 0.6 on the
-- title list scored 28/30 against 30/30 for equal weights; the two queries it
-- lost ("satan let loose in the flesh", "how to enter the most holy place")
-- had the right document found by the title branch but ranked just below the
-- top 3. The weights remain parameters so they can be swept, but note that
-- any retune measured only on the 30-query benchmark is fitting the test set.
--
-- Each list is limited inside a subquery before being ranked, so the vector
-- branch can still terminate early against the HNSW index.
create or replace function match_chunks_hybrid(
  query_embedding  vector(1536),
  query_text       text,
  match_count      int   default 15,
  per_document     int   default 3,
  candidate_count  int   default 60,
  rrf_k            int   default 60,
  weight_vector    float default 1.0,
  weight_text      float default 1.0,
  weight_title     float default 1.0,
  title_threshold  float default 0.25
)
returns table (
  id              bigint,
  content         text,
  source          text,
  title           text,
  speaker         text,
  date            text,
  url             text,
  soundcloud_url  text,
  page            integer,
  chunk_index     integer,
  similarity      float
)
language sql stable as $$
  with
  -- List 1: nearest neighbours by cosine distance.
  vector_hits as (
    select s.id, row_number() over (order by s.dist) as rank
    from (
      select c.id, c.embedding <=> query_embedding as dist
      from chunks c
      order by c.embedding <=> query_embedding
      limit candidate_count
    ) s
  ),
  -- List 2: lexical relevance. websearch_to_tsquery tolerates arbitrary user
  -- text without raising on punctuation; a stopword-only query yields an empty
  -- tsquery, which matches nothing, so this list simply goes empty.
  text_query as (
    select websearch_to_tsquery('english', coalesce(query_text, '')) as q
  ),
  text_hits as (
    select s.id, row_number() over (order by s.rnk desc, s.id) as rank
    from (
      select c.id, ts_rank_cd(to_tsvector('english', c.content), tq.q) as rnk
      from chunks c
      cross join text_query tq
      where to_tsvector('english', c.content) @@ tq.q
      order by rnk desc, c.id
      limit candidate_count
    ) s
  ),
  -- List 3: chunks of documents whose TITLE looks like the query. Trigram
  -- similarity rather than full-text, because stemming misses pairs like
  -- "hebrews 1:1 explained" / "Explanation of Hebrews 1:1" ('explain' vs
  -- 'explan'). Thresholded, so a conceptual question that resembles no title
  -- contributes nothing here instead of injecting arbitrary documents.
  title_docs as (
    select d.id, similarity(d.title, coalesce(query_text, '')) as title_sim
    from documents d
    where similarity(d.title, coalesce(query_text, '')) >= title_threshold
    order by title_sim desc
    limit 5
  ),
  title_hits as (
    select s.id, row_number() over (order by s.title_sim desc, s.dist) as rank
    from (
      select c.id, td.title_sim, c.embedding <=> query_embedding as dist
      from chunks c
      join title_docs td on td.id = c.document_id
      order by td.title_sim desc, dist
      limit candidate_count
    ) s
  ),
  fused as (
    select
      ids.id,
      coalesce(weight_vector / (rrf_k + v.rank), 0)
        + coalesce(weight_text / (rrf_k + t.rank), 0)
        + coalesce(weight_title / (rrf_k + n.rank), 0) as score
    from (
      select id from vector_hits
      union select id from text_hits
      union select id from title_hits
    ) ids
    left join vector_hits v on v.id = ids.id
    left join text_hits   t on t.id = ids.id
    left join title_hits  n on n.id = ids.id
  ),
  -- Per-document diversity cap: a single large document keeps only its best
  -- `per_document` chunks, so it can no longer occupy the whole result set.
  -- Deliberately not 1 — the textbook is genuinely the right answer for some
  -- queries, and should be able to contribute more than a single passage.
  capped as (
    select f.id, f.score,
           row_number() over (
             partition by c.document_id order by f.score desc, f.id
           ) as doc_rank
    from fused f
    join chunks c on c.id = f.id
  )
  select
    c.id,
    c.content,
    d.source,
    d.title,
    d.speaker,
    d.date,
    d.url,
    d.soundcloud_url,
    c.page,
    c.chunk_index,
    cap.score as similarity
  from capped cap
  join chunks c    on c.id = cap.id
  join documents d on d.id = c.document_id
  where cap.doc_rank <= per_document
  order by cap.score desc, c.id
  limit match_count;
$$;

-- Semantic search filtered by title. Prefer a case-insensitive exact title
-- when one exists; only use substring matching when no exact document exists.
-- This keeps a canonical "Satanic Spirits" filter from also searching its
-- "... in Ministers" and "... to Demons" sibling documents.
create or replace function match_chunks_filtered(
  query_embedding vector(1536),
  filter_title    text,
  match_count     int default 10,
  match_threshold float default 0.10
)
returns table (
  id              bigint,
  content         text,
  source          text,
  title           text,
  speaker         text,
  date            text,
  url             text,
  soundcloud_url  text,
  page            integer,
  chunk_index     integer,
  similarity      float
)
language sql stable as $$
  select
    c.id,
    c.content,
    d.source,
    d.title,
    d.speaker,
    d.date,
    d.url,
    d.soundcloud_url,
    c.page,
    c.chunk_index,
    1 - (c.embedding <=> query_embedding) as similarity
  from chunks c
  join documents d on d.id = c.document_id
  where (
      lower(d.title) = lower(filter_title)
      or (
        not exists (
          select 1
          from documents exact_document
          where lower(exact_document.title) = lower(filter_title)
        )
        and d.title ilike '%' || filter_title || '%'
      )
    )
    and 1 - (c.embedding <=> query_embedding) > match_threshold
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

-- Sequential document fetch with the same exact-first title semantics as
-- match_chunks_filtered. Substring matching remains the unresolved fallback.
create or replace function chunks_by_title(
  filter_title text,
  max_chunks   int default 40
)
returns table (
  id              bigint,
  content         text,
  source          text,
  title           text,
  speaker         text,
  date            text,
  url             text,
  soundcloud_url  text,
  page            integer,
  chunk_index     integer
)
language sql stable as $$
  select
    c.id,
    c.content,
    d.source,
    d.title,
    d.speaker,
    d.date,
    d.url,
    d.soundcloud_url,
    c.page,
    c.chunk_index
  from chunks c
  join documents d on d.id = c.document_id
  where lower(d.title) = lower(filter_title)
     or (
       not exists (
         select 1
         from documents exact_document
         where lower(exact_document.title) = lower(filter_title)
       )
       and d.title ilike '%' || filter_title || '%'
     )
  order by d.id, c.page nulls first, c.chunk_index
  limit max_chunks;
$$;

-- ============================================================================
-- Row Level Security
-- ============================================================================
--
-- The chat route runs server-side with the Secret key, which bypasses RLS.
-- We enable RLS on documents/chunks with NO policies, which means:
--   - Server (Secret key)        → full access (bypasses RLS)
--   - Browser (Publishable key)  → zero access (no policy = deny)
--
-- This locks down ingestion-only tables so a leaked publishable key can't
-- exfiltrate the corpus.

alter table documents enable row level security;
alter table chunks    enable row level security;

-- (No policies on documents/chunks — intentional.)

-- ============================================================================
-- Future tables (auth + chat history) — placeholders, uncomment when ready
-- ============================================================================
--
-- create table conversations (
--   id          uuid primary key default gen_random_uuid(),
--   user_id     uuid not null references auth.users(id) on delete cascade,
--   title       text,
--   created_at  timestamptz not null default now(),
--   updated_at  timestamptz not null default now()
-- );
--
-- create table messages (
--   id              uuid primary key default gen_random_uuid(),
--   conversation_id uuid not null references conversations(id) on delete cascade,
--   role            text not null check (role in ('user', 'assistant', 'system')),
--   parts           jsonb not null,
--   created_at      timestamptz not null default now()
-- );
--
-- create index messages_conversation_id_idx on messages (conversation_id, created_at);
--
-- alter table conversations enable row level security;
-- alter table messages      enable row level security;
--
-- create policy "own conversations"
--   on conversations for all
--   using  (auth.uid() = user_id)
--   with check (auth.uid() = user_id);
--
-- create policy "own messages"
--   on messages for all
--   using (
--     exists (select 1 from conversations c
--             where c.id = messages.conversation_id
--               and c.user_id = auth.uid())
--   )
--   with check (
--     exists (select 1 from conversations c
--             where c.id = messages.conversation_id
--               and c.user_id = auth.uid())
--   );
