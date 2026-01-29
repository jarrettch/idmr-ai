import { supabase } from "./supabase";
import { getEmbedding } from "./embeddings";

export interface ChunkResult {
  content: string;
  source: string;
  title: string;
  speaker?: string;
  date?: string;
  url?: string;
  similarity: number;
}

/**
 * Search by vector similarity across all chunks.
 */
export async function searchByContent(query: string): Promise<ChunkResult[]> {
  const embedding = await getEmbedding(query);

  const { data, error } = await supabase.rpc("match_chunks", {
    query_embedding: embedding,
    match_count: 10,
    match_threshold: 0.15,
  });

  if (error) {
    console.error("Supabase retrieval error:", error);
    return [];
  }

  return (data ?? []).map(mapRow);
}

/**
 * Fetch chunks from a specific document by title (sequential order).
 */
export async function searchByTitle(title: string): Promise<ChunkResult[]> {
  const { data } = await supabase
    .from("chunks")
    .select("content, source, title, speaker, date, url, chunk_index")
    .ilike("title", `%${title}%`)
    .order("chunk_index", { ascending: true })
    .limit(40);

  if (!data || data.length === 0) return [];

  return data.map((row) => ({
    content: row.content as string,
    source: row.source as string,
    title: row.title as string,
    speaker: row.speaker as string | undefined,
    date: row.date as string | undefined,
    url: row.url as string | undefined,
    similarity: 1.0,
  }));
}

/**
 * Vector search filtered to a specific document title.
 */
export async function searchWithinDocument(
  query: string,
  title: string
): Promise<ChunkResult[]> {
  const embedding = await getEmbedding(query);

  const { data, error } = await supabase.rpc("match_chunks_filtered", {
    query_embedding: embedding,
    filter_title: title,
    match_count: 10,
    match_threshold: 0.1,
  });

  if (error) {
    console.error("Filtered retrieval error:", error);
    return [];
  }

  return (data ?? []).map(mapRow);
}

function mapRow(row: Record<string, unknown>): ChunkResult {
  return {
    content: row.content as string,
    source: row.source as string,
    title: row.title as string,
    speaker: row.speaker as string | undefined,
    date: row.date as string | undefined,
    url: row.url as string | undefined,
    similarity: row.similarity as number,
  };
}
