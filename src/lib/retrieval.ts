import { supabase } from "./supabase";
import { getEmbedding } from "./embeddings";
import { resolveDocumentTitle } from "./resolve-document";

export interface ChunkResult {
  content: string;
  source: string;
  title: string;
  speaker?: string;
  date?: string;
  url?: string;
  soundcloud_url?: string;
  /**
   * Relevance score, display-only. Cosine similarity (0-1) from the vector
   * and title paths; a reciprocal-rank-fusion score (much smaller, ~0.01-0.05)
   * from `searchByContent`. Comparable within one result set, not across them.
   */
  similarity: number;
}

/**
 * General content search across all chunks. Hybrid: fuses vector similarity,
 * full-text relevance, and document-title similarity, then caps how many
 * chunks any one document may contribute. See `match_chunks_hybrid` in
 * `supabase/schema.sql` for the fusion itself and the benchmark that motivated
 * it (`specs/SEARCH-BENCHMARK-2026-07-29.md`).
 *
 * Falls back to plain vector search when the hybrid RPC is missing, so
 * deploying this code before applying the schema degrades rather than breaks.
 */
export async function searchByContent(query: string): Promise<ChunkResult[]> {
  const embedding = await getEmbedding(query);

  const { data, error } = await supabase.rpc("match_chunks_hybrid", {
    query_embedding: embedding,
    query_text: query,
    match_count: 15,
    per_document: 3,
  });

  if (!error) return (data ?? []).map(mapRow);

  if (isMissingFunction(error)) {
    console.warn(
      "match_chunks_hybrid not found — apply supabase/schema.sql. " +
        "Falling back to plain vector search."
    );
    return searchByContentVector(embedding);
  }

  console.error("Supabase hybrid retrieval error:", error);
  return [];
}

/** Plain vector search. The pre-hybrid behaviour, kept as the fallback path. */
async function searchByContentVector(
  embedding: number[]
): Promise<ChunkResult[]> {
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
 * PostgREST reports an unknown RPC as PGRST202 (no matching function in the
 * schema cache). Anything else is a real failure and must not be masked.
 */
function isMissingFunction(error: { code?: string; message?: string }): boolean {
  return (
    error.code === "PGRST202" ||
    /could not find the function/i.test(error.message ?? "")
  );
}

/**
 * Fetch chunks from a specific document (sequential order). Resolves loose
 * references — content headings ("Sunday Morning 74/75"), "also called" names
 * ("the Christmas tape"), dates, disputants — to the canonical document via a
 * fuzzy title/alias match. Falls back to the fuzzy ILIKE RPC on the raw
 * reference when nothing resolves confidently.
 */
export async function searchByTitle(ref: string): Promise<ChunkResult[]> {
  const canonical = resolveDocumentTitle(ref);
  if (canonical) {
    const exact = await chunksByExactTitle(canonical, 40);
    if (exact.length > 0) return exact;
  }

  const { data, error } = await supabase.rpc("chunks_by_title", {
    filter_title: ref,
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
 * Fetch a single document's chunks by exact title, in sequential order.
 * Precise (unlike the ILIKE RPC, this won't over-match titles that are
 * substrings of others, e.g. "Satanic Spirits").
 */
async function chunksByExactTitle(
  title: string,
  max: number
): Promise<ChunkResult[]> {
  const { data: doc, error: docError } = await supabase
    .from("documents")
    .select("id, source, title, speaker, date, url, soundcloud_url")
    .eq("title", title)
    .limit(1)
    .maybeSingle();

  if (docError || !doc) {
    if (docError) console.error("documents lookup error:", docError);
    return [];
  }

  const { data, error } = await supabase
    .from("chunks")
    .select("content, page, chunk_index")
    .eq("document_id", doc.id)
    .order("page", { nullsFirst: true })
    .order("chunk_index", { ascending: true })
    .limit(max);

  if (error) {
    console.error("chunks by document_id error:", error);
    return [];
  }

  return (data ?? []).map((c: Record<string, unknown>) => ({
    content: c.content as string,
    source: doc.source as string,
    title: doc.title as string,
    speaker: (doc.speaker as string | null) ?? undefined,
    date: (doc.date as string | null) ?? undefined,
    url: (doc.url as string | null) ?? undefined,
    soundcloud_url: (doc.soundcloud_url as string | null) ?? undefined,
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
  // Resolve loose references to the canonical title so the ILIKE filter lands
  // on the right document (falls back to the raw reference if unresolved).
  const filterTitle = resolveDocumentTitle(title) ?? title;

  const { data, error } = await supabase.rpc("match_chunks_filtered", {
    query_embedding: embedding,
    filter_title: filterTitle,
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
