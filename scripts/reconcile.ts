// Pure planning for embed.ts's stale-chunk reconciliation (Step 3). No I/O
// here so check-pipeline.ts can exercise the deletion semantics against
// mocked file/DB state without touching Supabase.

export interface FileChunkRef {
  docId: number;
  page: number | null;
  chunkIndex: number;
}

export interface DbChunkRow {
  id: number;
  docId: number;
  page: number | null;
  chunkIndex: number;
}

export interface DbDocRow {
  id: number;
  source: string;
  title: string;
}

export interface TailTrim {
  docId: number;
  page: number | null;
  maxIdx: number;
}

const chunkKey = (docId: number, page: number | null, chunkIndex: number) =>
  `${docId}::${page ?? "null"}::${chunkIndex}`;

/**
 * Default (partial-ingestion-safe) mode: for each (document, page) group
 * PRESENT in the chunks file, trim DB rows whose chunk_index exceeds the
 * file's max. Documents and pages absent from the file are never touched, so
 * embedding a partial file can never destroy unrelated data — the tradeoff is
 * that a page dropped or renumbered by a re-chunk keeps its stale rows until
 * a --full-snapshot run.
 */
export function planTailTrims(fileChunks: FileChunkRef[]): TailTrim[] {
  const groups = new Map<string, TailTrim>();
  for (const chunk of fileChunks) {
    const key = `${chunk.docId}::${chunk.page ?? "null"}`;
    const g = groups.get(key);
    if (g) g.maxIdx = Math.max(g.maxIdx, chunk.chunkIndex);
    else
      groups.set(key, {
        docId: chunk.docId,
        page: chunk.page,
        maxIdx: chunk.chunkIndex,
      });
  }
  return Array.from(groups.values());
}

/**
 * --full-snapshot mode: the chunks file is declared to be the COMPLETE
 * corpus. Two deletion sets follow:
 *  - staleChunkIds: rows of documents present in the file whose
 *    (page, chunk_index) is absent from the file — dropped/renumbered pages
 *    and mid-sequence gaps, not just shrunken tails.
 *  - absentDocs: DB documents with no chunks in the file at all; deleting the
 *    document row cascades to its chunks (chunks.document_id on delete
 *    cascade).
 * Callers must treat this as destructive and only run it when the file really
 * is the whole corpus.
 */
export function planFullSnapshot(
  fileChunks: FileChunkRef[],
  dbChunks: DbChunkRow[],
  dbDocs: DbDocRow[]
): { staleChunkIds: number[]; absentDocs: DbDocRow[] } {
  const presentDocIds = new Set(fileChunks.map((c) => c.docId));
  const fileKeys = new Set(
    fileChunks.map((c) => chunkKey(c.docId, c.page, c.chunkIndex))
  );

  const staleChunkIds = dbChunks
    .filter(
      (row) =>
        presentDocIds.has(row.docId) &&
        !fileKeys.has(chunkKey(row.docId, row.page, row.chunkIndex))
    )
    .map((row) => row.id);

  const absentDocs = dbDocs.filter((doc) => !presentDocIds.has(doc.id));

  return { staleChunkIds, absentDocs };
}
