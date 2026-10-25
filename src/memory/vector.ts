import type { MemoryRecallResult } from "../domain/domain.ts";
import { InvalidEmbeddingError } from "../domain/errors.ts";

export const EMBEDDING_DIMENSIONS = 384;
export const EMBEDDING_BYTE_LENGTH = EMBEDDING_DIMENSIONS * Float32Array.BYTES_PER_ELEMENT;

export function validateEmbedding(value: unknown): Float32Array {
  if (!(value instanceof Float32Array) || value.length !== EMBEDDING_DIMENSIONS) {
    throw new InvalidEmbeddingError(`Embedding must be a Float32Array with ${EMBEDDING_DIMENSIONS} values.`);
  }
  if (!Array.from(value).every(Number.isFinite)) {
    throw new InvalidEmbeddingError("Embedding values must all be finite.");
  }
  const norm = Math.sqrt(value.reduce((sum, component) => sum + component * component, 0));
  if (Math.abs(norm - 1) > 1e-3) {
    throw new InvalidEmbeddingError("Embedding must be L2-normalized.");
  }
  return new Float32Array(value);
}

export function encodeEmbedding(value: unknown): Uint8Array {
  const embedding = validateEmbedding(value);
  const bytes = new Uint8Array(EMBEDDING_BYTE_LENGTH);
  const view = new DataView(bytes.buffer);
  for (let index = 0; index < EMBEDDING_DIMENSIONS; index += 1) {
    view.setFloat32(index * Float32Array.BYTES_PER_ELEMENT, embedding[index], true);
  }
  return bytes;
}

export function decodeEmbedding(value: unknown): Float32Array {
  if (!(value instanceof Uint8Array) || value.byteLength !== EMBEDDING_BYTE_LENGTH) {
    throw new InvalidEmbeddingError(`Embedding BLOB must contain exactly ${EMBEDDING_BYTE_LENGTH} bytes.`);
  }
  const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
  const embedding = new Float32Array(EMBEDDING_DIMENSIONS);
  for (let index = 0; index < EMBEDDING_DIMENSIONS; index += 1) {
    embedding[index] = view.getFloat32(index * Float32Array.BYTES_PER_ELEMENT, true);
  }
  return validateEmbedding(embedding);
}

export function dotProduct(left: unknown, right: unknown): number {
  const first = validateEmbedding(left);
  const second = validateEmbedding(right);
  let score = 0;
  for (let index = 0; index < EMBEDDING_DIMENSIONS; index += 1) {
    score += first[index] * second[index];
  }
  return score;
}

export function compareRecallResults(
  left: MemoryRecallResult,
  right: MemoryRecallResult,
): number {
  return right.score - left.score
    || left.memory.createdAt.localeCompare(right.memory.createdAt)
    || left.memory.id.localeCompare(right.memory.id);
}
