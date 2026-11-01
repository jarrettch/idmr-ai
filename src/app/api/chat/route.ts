export const maxDuration = 60;

import { anthropic } from "@ai-sdk/anthropic";
import { type UIMessage, streamText, generateText, convertToModelMessages, tool } from "ai";
import { z } from "zod";
import {
  searchByContent,
  searchByTitle,
  searchWithinDocument,
  type ChunkResult,
} from "@/lib/retrieval";

const retrievalTools = {
  search_by_content: tool({
    description:
      "Search across all transcripts and textbook content using semantic similarity. Best for general questions about IDMR teachings, concepts, or topics that aren't tied to a specific document.",
    inputSchema: z.object({
      query: z
        .string()
        .describe("The search query — rephrase for best semantic match"),
    }),
  }),
  search_by_title: tool({
    description:
      'Retrieve all chunks from a specific transcript or document by title. Use this when the user wants a summary or overview of a specific document. For the textbook, the title is "Elohim the Archetype".',
    inputSchema: z.object({
      title: z
        .string()
        .describe(
          "The document title or partial title to match (case-insensitive)"
        ),
    }),
  }),
  search_within_document: tool({
    description:
      "Search for specific content within a particular document. Use when the user asks about a specific topic within a named transcript or the textbook.",
    inputSchema: z.object({
      query: z.string().describe("What to search for within the document"),
      title: z.string().describe("The document title to search within"),
    }),
  }),
};

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const lastUserMessage = [...messages]
    .reverse()
    .find((m) => m.role === "user");

  if (!lastUserMessage) {
    return new Response("No user message found", { status: 400 });
  }

  const queryText =
    lastUserMessage.parts
      .filter((p) => p.type === "text")
      .map((p) => (p as { type: "text"; text: string }).text)
      .join(" ");

  // Build brief conversation context for the query planner
  const recentMessages = messages.slice(-6).map(
    (m) =>
      `${m.role}: ${m.parts
        .filter((p) => p.type === "text")
        .map((p) => (p as { type: "text"; text: string }).text)
        .join(" ")}`
  );
  const conversationSummary = recentMessages.join("\n");

  // Step 1: Use a lightweight model to decide which retrieval tool(s) to call.
  // Haiku 5.5 is ~10x cheaper per token than Haiku 4.5 ($0.10/$0.50 vs
  // $1/$5 per MTok) and this call runs on every request. It also has adaptive
  // thinking ON by default, which a routing decision does not need, so effort
  // is pinned low. Do NOT add a `thinking` option here: this provider version
  // only models the old enabled/disabled shape, and a thinking budget is
  // rejected with a 400 on Haiku 5.5.
  const plannerResult = await generateText({
    model: anthropic("claude-haiku-5-5"),
    providerOptions: { anthropic: { effort: "low" } },
    system: `You are a query planner for an IDMR (Institute of Divine Metaphysical Research) knowledge base containing lecture transcripts and the textbook "Elohim the Archetype (Original) Pattern of the Universe."

Given the user's question and recent conversation context, decide which search tool(s) to call. You MUST call at least one tool.

Guidelines:
- If the user asks to summarize or get an overview of a specific transcript, use search_by_title with the transcript name.
- If the user asks about a specific topic within a named document (e.g. "does he mention X in that transcript"), use search_within_document.
- If the user references "the textbook", "the Archetype", "Volume", or "Elohim", the title is "Elohim the Archetype".
- If the user asks a general question about IDMR teachings, use search_by_content.
- If the user references "that one", "that transcript", "this lecture" etc., look at the conversation context to determine which document they mean.
- You can call multiple tools if needed.

Recent conversation:
${conversationSummary}`,
    prompt: queryText,
    tools: retrievalTools,
  });

  // Step 2: Execute the tool calls and collect results
  let allChunks: ChunkResult[] = [];

  for (const call of plannerResult.toolCalls) {
    let results: ChunkResult[] = [];
    const input = call.input as Record<string, string>;
    switch (call.toolName) {
      case "search_by_content":
        results = await searchByContent(input.query);
        break;
      case "search_by_title":
        results = await searchByTitle(input.title);
        break;
      case "search_within_document":
        results = await searchWithinDocument(input.query, input.title);
        break;
    }
    allChunks = allChunks.concat(results);
  }

  // Fallback: if planner didn't call any tools, do a general search
  if (allChunks.length === 0) {
    allChunks = await searchByContent(queryText);
  }

  // Dedupe chunks that appear in multiple tool results
  const seen = new Set<string>();
  allChunks = allChunks.filter((c) => {
    const key = `${c.title}::${c.source}::${c.content.slice(0, 100)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Step 3: Format context and stream the answer
  const context = allChunks
    .map((c, i) => {
      const sourceInfo = `[Source ${i + 1}] "${c.title}"${c.speaker ? ` by ${c.speaker}` : ""}${c.date ? ` (${c.date})` : ""}`;
      // Only include URL for transcripts (textbook is not hosted on idmr.net)
      const urlInfo = c.source === "transcript" && c.url ? `\nURL: ${c.url}` : "";
      // ~10 transcripts have a SoundCloud recording of the lecture
      const soundcloudInfo =
        c.source === "transcript" && c.soundcloud_url
          ? `\nSoundCloud: ${c.soundcloud_url}`
          : "";
      return `${sourceInfo}${urlInfo}${soundcloudInfo}\n${c.content}`;
    })
    .join("\n\n---\n\n");

  const systemPrompt = `You are a knowledgeable assistant specializing in IDMR (Institute of Divine Metaphysical Research) teachings, founded by Dr. Henry Clifford Kinley.

## Your Knowledge Base
You have access to:
- 98 lecture transcripts by Dr. Henry C. Kinley and other IDMR speakers, spanning from the late 1950s through the 1970s
- The textbook "Elohim the Archetype (Original) Pattern of the Universe" by Dr. Henry Clifford Kinley (Volumes I-IV)
- All content is sourced from idmr.net

## How to Answer
- Answer based on the retrieved source material below. Synthesize information across multiple sources when relevant.
- Reference specific sources (title, speaker, date) when possible.
- When citing transcript sources, include the URL as a markdown link so users can read the full transcript. Format: Source: [Title](URL)
- If a cited source also has a SoundCloud link, add a second markdown link labeled "Listen on SoundCloud" immediately after the transcript link. Format: Source: [Title](URL) · [Listen on SoundCloud](SoundCloud URL). Only do this when a SoundCloud link is provided for that source — never invent one.
- If multiple transcripts are relevant, include multiple links.
- The textbook "Elohim the Archetype" is not available online, so don't include links for textbook citations.
- If the retrieved sources don't contain enough information, say so and suggest what the user might search for instead.
- Be clear and direct. Use the language and terminology from the source material accurately.
- For broad theological questions, draw from multiple sources to give a comprehensive answer rather than relying on a single chunk.
- For questions about specific Bible verses, note that the transcripts use the divine names (Yahweh, Elohim, Yahshua) rather than conventional translations (Lord, God, Jesus).

Retrieved sources:
${context}`;

  const modelMessages = await convertToModelMessages(messages);

  // Sonnet 5.5 is both newer and cheaper than Sonnet 4.6 ($2/$10 vs $3/$15
  // per MTok). It rejects `temperature`/`top_p` and a disabled `thinking`,
  // none of which are set here, and it rejects a forced `tool_choice` — the
  // planner steers tool use from its prompt instead, so that stays safe.
  const result = streamText({
    model: anthropic("claude-sonnet-5-5"),
    system: systemPrompt,
    messages: modelMessages,
  });

  return result.toUIMessageStreamResponse();
}
