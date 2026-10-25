import assert from "node:assert/strict";
import test from "node:test";
import { withReflection } from "../../src/../src/strategies/reflection.ts";
import type { ReasoningStrategy } from "../../src/../src/strategies/strategy.ts";

test("counts actual critic model starts and every base run across feedback retries", async () => {
  let runs = 0;
  let starts = 0;
  const base: ReasoningStrategy = {
    name: "react",
    async run() {
      runs += 1;
      return {
        answer: `Answer ${runs}`,
        trace: [
          { type: "observation", content: `Tool observation ${runs}` },
          { type: "answer", content: `Answer ${runs}` },
        ],
        metrics: { llmCalls: runs, latencyMs: 2 },
      };
    },
  };
  const strategy = withReflection(base, {
    maxReflection: 2,
    now: (() => {
      let time = 100;
      return () => time += 7;
    })(),
    critic: async (_input, onModelCall) => {
      onModelCall();
      starts += 1;
      if (starts === 2) {
        onModelCall();
        starts += 1;
      }
      return {
        approved: starts >= 3,
        feedback: starts >= 3 ? "Evidence supports the answer." : "Check the tool observation.",
      };
    },
  });

  const result = await strategy.run("Question");
  assert.equal(runs, 2);
  assert.equal(starts, 3);
  assert.equal(result.metrics.llmCalls, 1 + 2 + 3);
  assert.equal(result.metrics.latencyMs, 7);
  assert.equal(result.trace.filter(({ type }) => type === "critique").length, 2);
  assert.match(result.trace.at(-1)?.content ?? "", /approved/i);
});

test("records rejection at the reflection limit and includes all base and critic calls", async () => {
  let baseCalls = 0;
  let modelStarts = 0;
  const base: ReasoningStrategy = {
    name: "plan-and-execute",
    async run() {
      baseCalls += 2;
      return {
        answer: "Still unsupported.",
        trace: [{ type: "observation", content: "Observed zero matching records." }],
        metrics: { llmCalls: 2, latencyMs: 1 },
      };
    },
  };
  const result = await withReflection(base, {
    maxReflection: 1,
    critic: async (_input, onModelCall) => {
      onModelCall();
      modelStarts += 1;
      return { approved: false, feedback: "Answer does not match observed count." };
    },
  }).run("What is the count?");

  assert.equal(baseCalls, 4);
  assert.equal(modelStarts, 2);
  assert.equal(result.metrics.llmCalls, 6);
  assert.equal(result.trace.filter(({ type }) => type === "critique").length, 2);
  assert.match(result.trace.at(-1)?.content ?? "", /not approved|retry limit/i);
});
