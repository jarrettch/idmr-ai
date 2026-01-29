import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const CHUNK_SIZE = 1000; // target chars per chunk
const CHUNK_OVERLAP = 200; // overlap in chars

interface TranscriptSource {
  title: string;
  speaker: string;
  date: string | null;
  url: string;
  content: string;
}

interface TextbookPage {
  page: number;
  content: string;
}

interface Chunk {
  source: string;
  title: string;
  speaker?: string;
  date?: string | null;
  url?: string;
  page?: number;
  chunk_index: number;
  content: string;
}

/**
 * Split text into chunks at sentence boundaries.
 * Falls back to word boundaries if no sentence break is found.
 */
function chunkText(text: string): string[] {
  // Normalize whitespace
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= CHUNK_SIZE) return [cleaned];

  const chunks: string[] = [];
  let start = 0;

  while (start < cleaned.length) {
    let end = start + CHUNK_SIZE;

    if (end >= cleaned.length) {
      chunks.push(cleaned.slice(start).trim());
      break;
    }

    // Look for the last sentence-ending punctuation within the window
    const window = cleaned.slice(start, end);
    const sentenceEnd = findLastSentenceBreak(window);

    if (sentenceEnd !== -1 && sentenceEnd > CHUNK_SIZE * 0.3) {
      // Found a sentence boundary past 30% of the chunk — use it
      end = start + sentenceEnd + 1;
    } else {
      // Fall back to last space (word boundary)
      const lastSpace = window.lastIndexOf(" ");
      if (lastSpace > CHUNK_SIZE * 0.3) {
        end = start + lastSpace;
      }
      // else: hard cut at CHUNK_SIZE (rare)
    }

    chunks.push(cleaned.slice(start, end).trim());

    // Overlap: step back
    start = end - CHUNK_OVERLAP;
    if (start < 0) start = 0;
    // Make sure we're advancing
    if (start >= end) start = end;
  }

  return chunks.filter((c) => c.length > 20);
}

function findLastSentenceBreak(text: string): number {
  // Match ". " or "? " or "! " or end-of-quote patterns
  // Look for sentence-ending punctuation followed by a space or end of string
  let lastIdx = -1;
  for (let i = text.length - 1; i >= 0; i--) {
    const ch = text[i];
    if ((ch === "." || ch === "?" || ch === "!") && (i === text.length - 1 || text[i + 1] === " ")) {
      // Avoid breaking on abbreviations like "Dr." "Mr." "Jr." etc.
      if (ch === "." && i >= 2) {
        const before = text.slice(Math.max(0, i - 3), i);
        if (/^(Dr|Mr|Ms|Jr|Sr|St|vs|Ph|Rd|No|Ch|ca)$/i.test(before.trim())) {
          continue;
        }
      }
      lastIdx = i;
      break;
    }
  }
  return lastIdx;
}

function loadTranscripts(dir: string): Chunk[] {
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  const chunks: Chunk[] = [];

  for (const file of files) {
    const data: TranscriptSource = JSON.parse(readFileSync(join(dir, file), "utf-8"));
    const textChunks = chunkText(data.content);
    for (let i = 0; i < textChunks.length; i++) {
      chunks.push({
        source: "transcript",
        title: data.title,
        speaker: data.speaker,
        date: data.date,
        url: data.url,
        chunk_index: i,
        content: textChunks[i],
      });
    }
  }

  return chunks;
}

function loadTextbook(filePath: string): Chunk[] {
  const pages: TextbookPage[] = JSON.parse(readFileSync(filePath, "utf-8"));
  const chunks: Chunk[] = [];

  // Combine pages into one big string, tracking page boundaries
  // Then chunk the whole thing for better sentence boundaries across pages
  const title = "Elohim the Archetype (Original) Pattern of the Universe";

  for (const page of pages) {
    if (!page.content || page.content.trim().length < 20) continue;
    const textChunks = chunkText(page.content);
    for (let i = 0; i < textChunks.length; i++) {
      chunks.push({
        source: "textbook",
        title,
        page: page.page,
        chunk_index: i,
        content: textChunks[i],
      });
    }
  }

  return chunks;
}

function main() {
  const dataDir = join(__dirname, "..", "data");

  console.log("Loading transcripts...");
  const transcriptChunks = loadTranscripts(join(dataDir, "raw"));
  console.log(`  ${transcriptChunks.length} transcript chunks`);

  console.log("Loading textbook...");
  const textbookChunks = loadTextbook(join(dataDir, "pdf_raw", "textbook.json"));
  console.log(`  ${textbookChunks.length} textbook chunks`);

  const allChunks = [...transcriptChunks, ...textbookChunks];
  console.log(`Total: ${allChunks.length} chunks`);

  // Stats
  const lengths = allChunks.map((c) => c.content.length);
  const avg = Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length);
  const cutMid = allChunks.filter((c) => !/[.!?"\u201D]$/.test(c.content.trim())).length;
  console.log(`Avg chunk length: ${avg} chars`);
  console.log(`Chunks ending mid-sentence: ${cutMid}/${allChunks.length} (${Math.round((100 * cutMid) / allChunks.length)}%)`);

  const outPath = join(dataDir, "processed", "chunks.jsonl");
  const lines = allChunks.map((c) => JSON.stringify(c));
  writeFileSync(outPath, lines.join("\n") + "\n");
  console.log(`Written to ${outPath}`);
}

main();
