import assert from "node:assert/strict";
import test from "node:test";
import {
  contextBreakdownSchema,
  createUsageRecorder,
  estimateContextBreakdown,
  estimateTokens,
  inputTokensFromLlmResult,
  sumPromptTokens,
} from "../../src/context/tokens.ts";

function llmResult(...inputTokens: number[]): unknown {
  return {
    generations: [inputTokens.map((input_tokens) => ({
      text: "",
      message: { usage_metadata: { input_tokens, output_tokens: 1, total_tokens: input_tokens + 1 } },
    }))],
  };
}

test("estimateTokens divides characters by four and rounds up", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("abc"), 1);
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens("abcde"), 2);
  assert.equal(estimateTokens("x".repeat(400)), 100);
});

test("estimateTokens counts non-ASCII text by its UTF-16 length", () => {
  const text = "ação🚨";
  assert.equal(text.length, 6);
  assert.equal(estimateTokens(text), 2);
});

test("inputTokensFromLlmResult reads usage_metadata.input_tokens", () => {
  assert.equal(inputTokensFromLlmResult(llmResult(120)), 120);
});

test("inputTokensFromLlmResult sums generations within one result", () => {
  assert.equal(inputTokensFromLlmResult(llmResult(100, 20)), 120);
});

test("inputTokensFromLlmResult falls back to llmOutput.tokenUsage.promptTokens", () => {
  assert.equal(inputTokensFromLlmResult({
    generations: [[{ text: "", message: {} }]],
    llmOutput: { tokenUsage: { promptTokens: 77, completionTokens: 3 } },
  }), 77);
});

test("inputTokensFromLlmResult returns null for missing or malformed usage", () => {
  assert.equal(inputTokensFromLlmResult(undefined), null);
  assert.equal(inputTokensFromLlmResult({}), null);
  assert.equal(inputTokensFromLlmResult({ generations: [] }), null);
  assert.equal(inputTokensFromLlmResult(llmResult(-1)), null);
  assert.equal(inputTokensFromLlmResult(llmResult(1.5)), null);
  assert.equal(inputTokensFromLlmResult({
    generations: [[{ text: "", message: { usage_metadata: { input_tokens: "10" } } }]],
  }), null);
});

test("sumPromptTokens sums values and propagates unavailability", () => {
  assert.equal(sumPromptTokens([]), null);
  assert.equal(sumPromptTokens([10, 20, 30]), 60);
  assert.equal(sumPromptTokens([10, null, 30]), null);
  assert.equal(sumPromptTokens([0]), 0);
});

test("createUsageRecorder sums every recorded model call", () => {
  const recorder = createUsageRecorder();
  assert.equal(recorder.promptTokens(), null);
  recorder.handler.handleLLMEnd(llmResult(100));
  recorder.handler.handleLLMEnd(llmResult(50));
  assert.equal(recorder.promptTokens(), 150);
});

test("createUsageRecorder reports null when any call lacks usage", () => {
  const recorder = createUsageRecorder();
  recorder.handler.handleLLMEnd(llmResult(100));
  recorder.handler.handleLLMEnd({ generations: [[{ text: "", message: {} }]] });
  assert.equal(recorder.promptTokens(), null);
});

test("usage recorders never share state", () => {
  const first = createUsageRecorder();
  const second = createUsageRecorder();
  first.handler.handleLLMEnd(llmResult(10));
  assert.equal(first.promptTokens(), 10);
  assert.equal(second.promptTokens(), null);
});

test("estimateContextBreakdown estimates each source and the total", () => {
  const breakdown = estimateContextBreakdown({
    history: "h".repeat(41),
    memory: "m".repeat(8),
    message: "hello",
  });
  assert.deepEqual(breakdown, { method: "chars/4", system: 0, history: 11, memory: 2, summary: 0, message: 2, total: 15 });
  assert.deepEqual(contextBreakdownSchema.parse(breakdown), breakdown);
});

test("estimateContextBreakdown yields zero for empty sources", () => {
  assert.deepEqual(
    estimateContextBreakdown({ history: "", memory: "", message: "" }),
    { method: "chars/4", system: 0, history: 0, memory: 0, summary: 0, message: 0, total: 0 },
  );
});

test("estimateContextBreakdown includes the summary in the total", () => {
  const breakdown = estimateContextBreakdown({
    history: "h".repeat(8),
    memory: "",
    summary: "s".repeat(20),
    message: "hi",
  });
  assert.deepEqual(breakdown, { method: "chars/4", system: 0, history: 2, memory: 0, summary: 5, message: 1, total: 8 });
  assert.throws(() => contextBreakdownSchema.parse({ method: "chars/4", system: 0, history: 0, memory: 0, message: 0, total: 0 }));
});
