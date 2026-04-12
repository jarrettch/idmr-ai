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

-- Semantic search filtered to documents whose title matches `filter_title`.
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
  where d.title ilike '%' || filter_title || '%'
    and 1 - (c.embedding <=> query_embedding) > match_threshold
  order by c.embedding <=> query_embedding
  limit match_count;
$$;

-- Sequential fetch of all chunks in a document, used for "summarize this transcript".
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
  where d.title ilike '%' || filter_title || '%'
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
