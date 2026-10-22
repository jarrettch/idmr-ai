import { openai } from "@ai-sdk/openai";
import { embedMany, embed } from "ai";

const embeddingModel = openai.embedding("text-embedding-3-small");

export async function getEmbedding(text: string): Promise<number[]> {
  const { embedding } = await embed({ model: embeddingModel, value: text });
  return embedding;
}

export async function getEmbeddings(
  texts: string[],
  options?: { maxRetries?: number }
): Promise<{ embeddings: number[][] }> {
  const { embeddings } = await embedMany({
    model: embeddingModel,
    values: texts,
    maxRetries: options?.maxRetries,
  });
  return { embeddings };
}
