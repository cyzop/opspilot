import assert from "node:assert/strict";
import test from "node:test";
import { withReflection } from "../../src/../src/strategies/reflection.ts";
import type { ReasoningStrategy } from "../../src/../src/strategies/strategy.ts";
import type { StrategyResult } from "../../src/trace/trace.ts";

function makeResult(answer: string, extraObservation = ""): StrategyResult {
  return {
    answer,
    trace: [
      { type: "thought", content: "private chain-of-thought" },
      {
        type: "observation",
        content: `Tool result: {"apiKey":"secret-value"}; firing alerts: ${extraObservation || "one critical"}`,
      },
      { type: "answer", content: answer },
    ],
    metrics: { llmCalls: 1, latencyMs: 4 },
  };
}

test("returns an approved answer with base trace and one critique, without regeneration at zero", async () => {
  let runs = 0;
  let criticCalls = 0;
  const base: ReasoningStrategy = {
    name: "react",
    async run() {
      runs += 1;
      return makeResult("One critical alert is firing.");
    },
  };
  const strategy = withReflection(base, {
    maxReflection: 0,
    critic: async (input, onModelCall) => {
      criticCalls += 1;
      assert.equal(input.answer, "One critical alert is firing.");
      assert.equal(input.observations.length, 1);
      assert.match(input.observations[0] ?? "", /one critical/);
      assert.doesNotMatch(JSON.stringify(input), /secret-value|private chain-of-thought/);
      onModelCall();
      return { approved: true, feedback: "Supported by the observed alert." };
    },
  });

  const result = await strategy.run("How many critical alerts are firing?");
  assert.equal(runs, 1);
  assert.equal(criticCalls, 1);
  assert.equal(result.answer, "One critical alert is firing.");
  assert.deepEqual(result.trace.map(({ type }) => type), [
    "thought",
    "observation",
    "answer",
    "critique",
  ]);
  assert.match(result.trace.at(-1)?.content ?? "", /approved/i);
  assert.equal(result.metrics.llmCalls, 2);
});

test("retries rejected answers with original request, observations, and feedback up to default limit", async () => {
  const inputs: string[] = [];
  const reviews: Array<{ answer: string; observations: string[] }> = [];
  let candidate = 0;
  let clock = 0;
  const base: ReasoningStrategy = {
    name: "plan-and-execute",
    async run(input) {
      inputs.push(input);
      candidate += 1;
      return makeResult(`Candidate ${candidate}.`, `candidate ${candidate}`);
    },
  };
  const strategy = withReflection(base, {
    critic: async (review, onModelCall) => {
      onModelCall();
      reviews.push({ answer: review.answer, observations: review.observations });
      return reviews.length < 3
        ? {
          approved: false,
          feedback: `Please correct candidate ${reviews.length}; token=critic-secret.`,
        }
        : { approved: true, feedback: "The final answer matches the evidence." };
    },
    now: () => clock++,
  });

  const result = await strategy.run("How many critical alerts are firing?");
  assert.equal(candidate, 3);
  assert.equal(reviews.length, 3);
  assert.equal(reviews[0]?.answer, "Candidate 1.");
  assert.ok(inputs[1]?.includes("How many critical alerts are firing?"));
  assert.ok(inputs[1]?.includes("Please correct candidate 1;"));
  assert.doesNotMatch(inputs.join("\n"), /critic-secret/);
  assert.ok(inputs[1]?.includes("candidate 1"));
  assert.ok(inputs[2]?.includes("Please correct candidate 2;"));
  assert.equal(result.answer, "Candidate 3.");
  assert.equal(result.metrics.llmCalls, 6);
  assert.equal(result.metrics.latencyMs, 1);
  assert.deepEqual(result.trace.map(({ type }) => type), [
    "thought", "observation", "answer", "critique",
    "thought", "observation", "answer", "critique",
    "thought", "observation", "answer", "critique",
  ]);
  assert.doesNotMatch(inputs.join("\n"), /private chain-of-thought|secret-value/);
});

test("returns the latest rejected answer and marks retry exhaustion explicitly", async () => {
  let runs = 0;
  const base: ReasoningStrategy = {
    name: "react",
    async run() {
      runs += 1;
      return makeResult(`Candidate ${runs}.`);
    },
  };
  const strategy = withReflection(base, {
    maxReflection: 1,
    critic: async (_review, onModelCall) => {
      onModelCall();
      return { approved: false, feedback: "The count is not supported." };
    },
  });

  const result = await strategy.run("Count critical alerts.");
  assert.equal(runs, 2);
  assert.equal(result.answer, "Candidate 2.");
  assert.match(result.trace.at(-1)?.content ?? "", /not approved|retry limit/i);
  assert.equal(result.metrics.llmCalls, 4);
});

test("rejects invalid options and malformed or blank critic decisions", async () => {
  const base: ReasoningStrategy = { name: "react", run: async () => makeResult("Candidate.") };
  for (const maxReflection of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => withReflection(base, { maxReflection }), /maxReflection/i);
  }
  for (const critic of [
    async () => ({ approved: "yes", feedback: "no" }),
    async () => ({ approved: false, feedback: " " }),
  ]) {
    await assert.rejects(withReflection(base, { maxReflection: 0, critic }).run("question"));
  }
});

test("propagates base and critic failures instead of returning a success-shaped result", async () => {
  const baseFailure: ReasoningStrategy = {
    name: "react",
    async run() {
      throw new Error("base failed");
    },
  };
  await assert.rejects(
    withReflection(baseFailure, { critic: async () => ({ approved: true, feedback: "ok" }) })
      .run("question"),
    /base failed/,
  );

  const base: ReasoningStrategy = { name: "react", run: async () => makeResult("Candidate.") };
  await assert.rejects(
    withReflection(base, {
      critic: async () => {
        throw new Error("critic failed");
      },
    }).run("question"),
    /critic failed/,
  );

  let runs = 0;
  const regenerationFailure: ReasoningStrategy = {
    name: "react",
    async run() {
      runs += 1;
      if (runs > 1) throw new Error("regeneration failed");
      return makeResult("Rejected answer.");
    },
  };
  await assert.rejects(
    withReflection(regenerationFailure, {
      critic: async (_input, onModelCall) => {
        onModelCall();
        return { approved: false, feedback: "token=critic-secret Do not use it." };
      },
    }).run("question"),
    /regeneration failed/,
  );
  assert.equal(runs, 2);
});

function usageResult(inputTokens: number): unknown {
  return {
    generations: [[{ text: "", message: { usage_metadata: { input_tokens: inputTokens, output_tokens: 1, total_tokens: inputTokens + 1 } } }]],
  };
}

function baseWithTokens(promptTokens?: number): ReasoningStrategy {
  return {
    name: "react",
    async run() {
      const result = makeResult("One critical alert is firing.");
      return promptTokens === undefined
        ? result
        : { ...result, metrics: { ...result.metrics, promptTokens } };
    },
  };
}

test("sums base strategy and critic promptTokens", async () => {
  const strategy = withReflection(baseWithTokens(500), {
    maxReflection: 0,
    critic: async (_input, onModelCall, callbacks) => {
      onModelCall();
      for (const callback of callbacks ?? []) callback.handleLLMEnd(usageResult(120));
      return { approved: true, feedback: "ok" };
    },
  });

  const result = await strategy.run("How many critical alerts are firing?");
  assert.equal(result.metrics.promptTokens, 620);
});

test("sums promptTokens of every regeneration round", async () => {
  let reviews = 0;
  const strategy = withReflection(baseWithTokens(500), {
    maxReflection: 2,
    critic: async (_input, onModelCall, callbacks) => {
      onModelCall();
      reviews += 1;
      for (const callback of callbacks ?? []) callback.handleLLMEnd(usageResult(100));
      return { approved: reviews === 2, feedback: reviews === 2 ? "ok" : "retry" };
    },
  });

  const result = await strategy.run("How many critical alerts are firing?");
  assert.equal(result.metrics.promptTokens, 1200);
});

test("reports promptTokens as null when the base strategy lacks usage", async () => {
  const strategy = withReflection(baseWithTokens(), {
    maxReflection: 0,
    critic: async (_input, onModelCall, callbacks) => {
      onModelCall();
      for (const callback of callbacks ?? []) callback.handleLLMEnd(usageResult(120));
      return { approved: true, feedback: "ok" };
    },
  });

  const result = await strategy.run("How many critical alerts are firing?");
  assert.equal(result.metrics.promptTokens, null);
});
