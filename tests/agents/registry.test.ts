import assert from "node:assert/strict";
import test from "node:test";
import { createStrategyRegistry, resolveStrategy } from "../../src/agentes/index.ts";
import { UnknownStrategyError } from "../../src/domain/errors.ts";
import type { StrategyResult } from "../../src/trace/trace.ts";

function fakeResult(answer: string): StrategyResult {
  return {
    answer,
    trace: [{ type: "answer", content: answer }],
    metrics: { llmCalls: 1, latencyMs: 5 },
  };
}

test("resolves the default strategies and applies reflection when requested", async () => {
  const registry = createStrategyRegistry({
    createReactStrategyFactory: () => ({
      name: "react",
      async run(input) {
        return fakeResult(`react:${input}`);
      },
    }),
    createPlanAndExecuteStrategyFactory: () => ({
      name: "plan-and-execute",
      async run(input) {
        return fakeResult(`plan:${input}`);
      },
    }),
    withReflectionFactory: (strategy, maxReflection) => ({
      name: strategy.name,
      async run(input) {
        const base = await strategy.run(input);
        return {
          ...base,
          answer: `reflected:${maxReflection}:${base.answer}`,
          trace: [...base.trace, { type: "critique", content: "reviewed" }],
        };
      },
    }),
  });

  const react = registry.resolve("react");
  const reflected = registry.resolve("plan-and-execute", true, 3);

  assert.equal(react.name, "react");
  assert.equal((await reflected.run("hello")).answer, "reflected:3:plan:hello");
  assert.equal((await resolveStrategy("react")).name, "react");
});

test("rejects unsupported strategy names without fallback", () => {
  assert.throws(() => resolveStrategy("custom"), UnknownStrategyError);
  assert.throws(() => createStrategyRegistry().resolve("unknown"), UnknownStrategyError);
});
