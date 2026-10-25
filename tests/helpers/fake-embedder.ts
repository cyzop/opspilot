import type { EmbeddingFunction } from "../../src/memory/embeddings.ts";

export const EMBEDDING_DIMENSIONS = 384;

export function normalizedVector(
  values: Readonly<Record<number, number>>,
): Float32Array {
  const vector = new Float32Array(EMBEDDING_DIMENSIONS);
  for (const [index, value] of Object.entries(values)) {
    vector[Number(index)] = value;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) {
    throw new Error("Fake embedding must be non-zero.");
  }
  for (let index = 0; index < vector.length; index += 1) {
    vector[index] /= norm;
  }
  return vector;
}

export function vectorWithFirstComponent(score: number, secondaryIndex = 1): Float32Array {
  const remainder = Math.sqrt(1 - score * score);
  return normalizedVector({ 0: score, [secondaryIndex]: remainder });
}

export function createFakeEmbedder(
  vectors: Readonly<Record<string, Float32Array>>,
): { embed: EmbeddingFunction; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    embed: async (text) => {
      calls.push(text);
      const vector = vectors[text];
      if (!vector) {
        throw new Error(`No fake embedding configured for: ${text}`);
      }
      return new Float32Array(vector);
    },
  };
}
