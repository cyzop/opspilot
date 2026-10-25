import assert from "node:assert/strict";
import test from "node:test";
import {
  embed,
  resetEmbeddingPipelineForTests,
  setEmbeddingPipelineFactory,
  type EmbeddingPipeline,
} from "../../src/memory/embeddings.ts";
import { normalizedVector } from "../helpers/fake-embedder.ts";

test("embedding initialization is lazy and shared across concurrent first calls", async (context) => {
  let initializeCount = 0;
  let resolvePipeline: ((pipeline: EmbeddingPipeline) => void) | undefined;
  const pipelinePromise = new Promise<EmbeddingPipeline>((resolve) => {
    resolvePipeline = resolve;
  });
  setEmbeddingPipelineFactory(() => {
    initializeCount += 1;
    return pipelinePromise;
  });
  context.after(resetEmbeddingPipelineForTests);

  assert.equal(initializeCount, 0);
  const vector = normalizedVector({ 0: 1 });
  const calls: Array<[string, unknown]> = [];
  const pipeline: EmbeddingPipeline = async (text, options) => {
    calls.push([text, options]);
    return { data: vector, dims: [1, 384] };
  };
  const first = embed("first");
  const second = embed("second");
  assert.equal(initializeCount, 1);
  resolvePipeline?.(pipeline);

  assert.deepEqual(await first, vector);
  assert.deepEqual(await second, vector);
  assert.deepEqual(calls, [
    ["first", { pooling: "mean", normalize: true }],
    ["second", { pooling: "mean", normalize: true }],
  ]);
});

test("embedding initialization failure is surfaced and allows a retry", async (context) => {
  let initializeCount = 0;
  setEmbeddingPipelineFactory(async () => {
    initializeCount += 1;
    if (initializeCount === 1) {
      throw new Error("temporary model load failure");
    }
    return async () => ({ data: normalizedVector({ 0: 1 }), dims: [1, 384] });
  });
  context.after(resetEmbeddingPipelineForTests);

  await assert.rejects(embed("first"), /temporary model load failure/);
  assert.equal((await embed("retry")).length, 384);
  assert.equal(initializeCount, 2);
});
