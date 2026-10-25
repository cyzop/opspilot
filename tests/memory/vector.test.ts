import assert from "node:assert/strict";
import test from "node:test";
import type { MemoryRecallResult } from "../../src/domain/domain.ts";
import {
  decodeEmbedding,
  dotProduct,
  encodeEmbedding,
  validateEmbedding,
} from "../../src/memory/vector.ts";
import { InvalidEmbeddingError } from "../../src/domain/errors.ts";
import { normalizedVector } from "../helpers/fake-embedder.ts";

test("Float32 embeddings round-trip through SQLite BLOB bytes", () => {
  const original = normalizedVector({ 0: 0.6, 1: 0.8 });
  const bytes = encodeEmbedding(original);

  assert.equal(bytes.byteLength, 1536);
  assert.deepEqual(decodeEmbedding(bytes), original);
});

test("embedding validation rejects malformed dimensions and non-finite values", () => {
  assert.throws(
    () => validateEmbedding(new Float32Array(383)),
    InvalidEmbeddingError,
  );
  const invalid = normalizedVector({ 0: 1 });
  invalid[3] = Number.NaN;
  assert.throws(() => validateEmbedding(invalid), InvalidEmbeddingError);
  assert.throws(() => decodeEmbedding(new Uint8Array(12)), InvalidEmbeddingError);
});

test("dot product ranks normalized vectors and ties use stable record fields", async () => {
  const aligned = normalizedVector({ 2: 1 });
  const offset = normalizedVector({ 3: 1 });
  assert.equal(dotProduct(aligned, aligned), 1);
  assert.equal(dotProduct(aligned, offset), 0);

  const { compareRecallResults } = await import("../../src/memory/vector.ts");
  const makeResult = (id: string, createdAt: string, score: number) => ({
    memory: {
      id,
      userId: "user",
      fact: id,
      embedding: aligned,
      createdAt,
    },
    score,
  });
  const results: MemoryRecallResult[] = [
    makeResult("z", "2026-01-01T00:00:00.000Z", 0.7),
    makeResult("b", "2026-01-01T00:00:00.000Z", 0.8),
    makeResult("a", "2026-01-01T00:00:00.000Z", 0.8),
    makeResult("older", "2025-01-01T00:00:00.000Z", 0.8),
  ];
  results.sort(compareRecallResults);
  assert.deepEqual(results.map(({ memory }) => memory.id), ["older", "a", "b", "z"]);
});
