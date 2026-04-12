import { supabase } from "./supabase";
import { getEmbedding } from "./embeddings";

export interface ChunkResult {
  content: string;
  source: string;
  title: string;
  speaker?: string;
  date?: string;
  url?: string;
  soundcloud_url?: string;
  similarity: number;
}

/**
 * Search by vector similarity across all chunks.
 */
export async function searchByContent(query: string): Promise<ChunkResult[]> {
  const embedding = await getEmbedding(query);

  const { data, error } = await supabase.rpc("match_chunks", {
    query_embedding: embedding,
    match_count: 15,
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
  const { data, error } = await supabase.rpc("chunks_by_title", {
    filter_title: title,
    max_chunks: 40,
  });

  if (error) {
    console.error("chunks_by_title error:", error);
    return [];
  }

  return (data ?? []).map((row: Record<string, unknown>) => ({
    ...mapRow(row),
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
    speaker: (row.speaker as string | null) ?? undefined,
    date: (row.date as string | null) ?? undefined,
    url: (row.url as string | null) ?? undefined,
    soundcloud_url: (row.soundcloud_url as string | null) ?? undefined,
    similarity: row.similarity as number,
  };
}
