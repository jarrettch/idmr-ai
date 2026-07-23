export interface DocumentIdentity {
  source: "transcript" | "textbook";
  title: string;
}

// Pipeline-wide exclusions belong here so chunking, alias generation, and
// future ingestion consumers cannot silently disagree about the corpus.
const EXCLUDED_DOCUMENT_KEYS = new Set([
  "transcript\u0000Transcripts", // scraped index page, not a lecture
]);

export function shouldIncludeDocument(document: DocumentIdentity): boolean {
  return !EXCLUDED_DOCUMENT_KEYS.has(
    `${document.source}\u0000${document.title}`
  );
}
