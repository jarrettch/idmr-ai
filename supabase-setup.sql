-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor > New Query)

-- 1. Enable pgvector extension
create extension if not exists vector;

-- 2. Create chunks table
create table chunks (
  id bigserial primary key,
  content text not null,
  source text not null,
  title text not null,
  speaker text,
  date text,
  url text,
  page integer,
  chunk_index integer not null,
  embedding vector(1536), -- OpenAI text-embedding-3-small dimensions
  unique (source, title, chunk_index)
);

-- 3. Create index for fast similarity search
create index on chunks using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- 4. Create the match function used by the app
create or replace function match_chunks(
  query_embedding vector(1536),
  match_count int default 6,
  match_threshold float default 0.3
)
returns table (
  id bigint,
  content text,
  source text,
  title text,
  speaker text,
  date text,
  url text,
  page integer,
  chunk_index integer,
  similarity float
)
language sql stable
as $$
  select
    chunks.id,
    chunks.content,
    chunks.source,
    chunks.title,
    chunks.speaker,
    chunks.date,
    chunks.url,
    chunks.page,
    chunks.chunk_index,
    1 - (chunks.embedding <=> query_embedding) as similarity
  from chunks
  where 1 - (chunks.embedding <=> query_embedding) > match_threshold
  order by chunks.embedding <=> query_embedding
  limit match_count;
$$;
