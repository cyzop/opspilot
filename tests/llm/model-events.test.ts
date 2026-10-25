import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { collectModelFallbacks, reportModelFallback, type ModelFallbackReport } from "../../src/llm/model-events.ts";

const report = (reason: string): ModelFallbackReport => ({ primaryModel: "p", reserveModel: "r", reason });

test("collects reports made inside the scope, across awaits and nested promises", async () => {
  const { value, fallbacks } = await collectModelFallbacks(async () => {
    reportModelFallback(report("first"));
    await delay(1);
    await Promise.all([
      (async () => { await delay(1); reportModelFallback(report("second")); })(),
    ]);
    return 42;
  });
  assert.equal(value, 42);
  assert.deepEqual(fallbacks.map(({ reason }) => reason), ["first", "second"]);
});

test("concurrent scopes do not mix their reports", async () => {
  const run = (label: string, wait: number) => collectModelFallbacks(async () => {
    await delay(wait);
    reportModelFallback(report(label));
  });
  const [a, b] = await Promise.all([run("a", 5), run("b", 1)]);
  assert.deepEqual(a.fallbacks.map(({ reason }) => reason), ["a"]);
  assert.deepEqual(b.fallbacks.map(({ reason }) => reason), ["b"]);
});

test("nested scopes keep reports in the innermost scope only", async () => {
  const outer = await collectModelFallbacks(async () => {
    reportModelFallback(report("outer"));
    const inner = await collectModelFallbacks(async () => reportModelFallback(report("inner")));
    return inner.fallbacks;
  });
  assert.deepEqual(outer.value.map(({ reason }) => reason), ["inner"]);
  assert.deepEqual(outer.fallbacks.map(({ reason }) => reason), ["outer"]);
});

test("reporting outside any scope is a no-op", () => {
  assert.doesNotThrow(() => reportModelFallback(report("nowhere")));
});

test("a caller-owned list keeps reports when the scope throws", async () => {
  const kept: ModelFallbackReport[] = [];
  await assert.rejects(collectModelFallbacks(async () => {
    reportModelFallback(report("before failure"));
    throw new Error("boom");
  }, kept));
  assert.deepEqual(kept.map(({ reason }) => reason), ["before failure"]);
});
