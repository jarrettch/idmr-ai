-- Fix: include page in unique constraint for textbook chunks
alter table chunks drop constraint if exists chunks_source_title_chunk_index_key;
alter table chunks add constraint chunks_unique_key unique (source, title, chunk_index, page);
