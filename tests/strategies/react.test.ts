import assert from "node:assert/strict";
import test from "node:test";
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { createOpsStore } from "../../src/store/ops-store.ts";
import { createOpsTools } from "../../src/tools/index.ts";
import { createReactStrategy } from "../../src/../src/strategies/react.ts";

function actionMessage(): AIMessage {
  return new AIMessage({
    content: "",
    tool_calls: [{
      id: "call-list-alerts",
      name: "list_alerts",
      args: { status: "firing" },
      type: "tool_call",
    }],
  });
}

function observationMessage(): ToolMessage {
  return new ToolMessage({
    content: '[{"id":"alert-api-latency"}]',
    tool_call_id: "call-list-alerts",
  });
}

test("captures tool actions, observations, answer, and actual model-call count", async () => {
  const strategy = createReactStrategy({
    agentRunner: async (_input, beforeModelCall) => {
      beforeModelCall();
      beforeModelCall();
      return [
        actionMessage(),
        observationMessage(),
        new AIMessage("There are three firing alerts."),
      ];
    },
    tools: Object.values(createOpsTools(createOpsStore())),
    maxIterations: 2,
  });
  const result = await strategy.run("List firing alerts");

  assert.equal(strategy.name, "react");
  assert.equal(result.answer, "There are three firing alerts.");
  assert.deepEqual(result.trace.map(({ type }) => type), ["thought", "action", "observation", "answer"]);
  assert.equal(result.trace[1]?.type === "action" ? result.trace[1].tool : "", "list_alerts");
  assert.equal(result.metrics.llmCalls, 2);
  assert.ok(result.metrics.latencyMs >= 0);
});

test("returns a bounded result when another model call would exceed the limit", async () => {
  const strategy = createReactStrategy({
    agentRunner: async (_input, beforeModelCall) => {
      beforeModelCall();
      const messages = [actionMessage(), observationMessage()];
      try {
        beforeModelCall();
      } catch {
        return messages;
      }
      return messages;
    },
    tools: Object.values(createOpsTools(createOpsStore())),
    maxIterations: 1,
  });

  const result = await strategy.run("List firing alerts");
  assert.equal(result.metrics.llmCalls, 1);
  assert.match(result.answer, /limit/i);
  assert.deepEqual(result.trace.map(({ type }) => type), ["thought", "action", "observation", "answer"]);
});

test("surfaces model errors rather than returning a fabricated answer", async () => {
  const strategy = createReactStrategy({
    agentRunner: async (_input, beforeModelCall) => {
      beforeModelCall();
      throw new Error("model failed");
    },
    tools: Object.values(createOpsTools(createOpsStore())),
    maxIterations: 2,
  });

  await assert.rejects(strategy.run("Check alerts"), /model failed/);
});

function usageResult(inputTokens: number): unknown {
  return {
    generations: [[{ text: "", message: { usage_metadata: { input_tokens: inputTokens, output_tokens: 1, total_tokens: inputTokens + 1 } } }]],
  };
}

function usageHandler(callbacks: readonly object[]): { handleLLMEnd(output: unknown): void } {
  const handler = callbacks.find((callback) => "handleLLMEnd" in callback);
  assert.ok(handler, "expected a usage callback");
  return handler as { handleLLMEnd(output: unknown): void };
}

test("reports promptTokens as the sum of provider usage across model calls", async () => {
  const strategy = createReactStrategy({
    agentRunner: async (_input, beforeModelCall, callbacks) => {
      const handler = usageHandler(callbacks ?? []);
      beforeModelCall();
      handler.handleLLMEnd(usageResult(300));
      beforeModelCall();
      handler.handleLLMEnd(usageResult(450));
      return [actionMessage(), observationMessage(), new AIMessage("Done.")];
    },
    tools: Object.values(createOpsTools(createOpsStore())),
    maxIterations: 4,
  });

  const result = await strategy.run("List firing alerts");
  assert.equal(result.metrics.promptTokens, 750);
});

test("reports promptTokens as null when no provider usage was observed", async () => {
  const strategy = createReactStrategy({
    agentRunner: async (_input, beforeModelCall) => {
      beforeModelCall();
      return [new AIMessage("Done.")];
    },
    tools: Object.values(createOpsTools(createOpsStore())),
    maxIterations: 2,
  });

  const result = await strategy.run("List firing alerts");
  assert.equal(result.metrics.promptTokens, null);
});

test("the real ReAct agent answers through the reserve model and fails cleanly without one", async () => {
  const { createModel } = await import("../../src/llm/model.ts");
  const { ModelUnavailableError } = await import("../../src/domain/errors.ts");
  const { createFakeChatModel, httpError } = await import("../helpers/fake-chat-model.ts");
  const env = { OPENROUTER_API_KEY: "k", OPENROUTER_MODEL: "p/one", OPENROUTER_MODEL_FALLBACK: "r/two" };
  const build = (reserve: string | Error) => {
    const primary = createFakeChatModel("p/one", [httpError(503)]);
    const backup = createFakeChatModel("r/two", [reserve]);
    return createModel(env, { attempts: 1, buildChatModel: (name) => (name === "p/one" ? primary.model : backup.model) });
  };

  const ok = createReactStrategy({ maxIterations: 4, model: build("Resposta da reserva"), tools: [] });
  assert.equal((await ok.run("oi")).answer, "Resposta da reserva");

  const down = createReactStrategy({ maxIterations: 4, model: build(httpError(502)), tools: [] });
  await assert.rejects(down.run("oi"), ModelUnavailableError);
});

test("under the /chat approval policy the real ReAct agent pauses at resolve_incident", async () => {
  const { runWithApprovalPolicy, HTTP_APPROVAL_POLICY } = await import("../../src/approval/approval-context.ts");
  const { ApprovalRequiredError } = await import("../../src/approval/approval-errors.ts");
  const { FakeToolCallingModel } = await import("../helpers/fake-tool-calling-model.ts");
  const { createOpsTools } = await import("../../src/tools/index.ts");
  const { SqliteOpsStore } = await import("../../src/store/sqlite-ops-store.ts");
  const store = new SqliteOpsStore(":memory:");
  try {
    const model = new FakeToolCallingModel([
      { tool: "resolve_incident", args: { id: "incident-001" } },
      "should never be reached",
    ]);
    const strategy = createReactStrategy({ maxIterations: 4, model, tools: Object.values(createOpsTools(store)) });
    const error = await runWithApprovalPolicy(HTTP_APPROVAL_POLICY, () => strategy.run("Resolva o incidente incident-001"))
      .then(() => undefined, (caught: unknown) => caught);
    assert.ok(error instanceof ApprovalRequiredError);
    assert.equal(model.inputs.length, 1, "no model call after the pause");
    assert.deepEqual(error.trace.map(({ type }) => type), ["thought", "action"]);
    assert.equal(error.trace[1]?.type === "action" && error.trace[1].tool, "resolve_incident");
    assert.equal(error.metrics?.llmCalls, 1);
  } finally {
    store.close();
  }
});

test("other tool errors still reach the model as observations", async () => {
  const { runWithApprovalPolicy, HTTP_APPROVAL_POLICY } = await import("../../src/approval/approval-context.ts");
  const { FakeToolCallingModel } = await import("../helpers/fake-tool-calling-model.ts");
  const { createOpsTools } = await import("../../src/tools/index.ts");
  const { SqliteOpsStore } = await import("../../src/store/sqlite-ops-store.ts");
  const store = new SqliteOpsStore(":memory:");
  try {
    const model = new FakeToolCallingModel([
      { tool: "consultar_runbook", args: { service: "nao-existe" } },
      "Não há runbook para esse serviço.",
    ]);
    const strategy = createReactStrategy({ maxIterations: 4, model, tools: Object.values(createOpsTools(store)) });
    const result = await runWithApprovalPolicy(HTTP_APPROVAL_POLICY, () => strategy.run("runbook?"));
    assert.equal(result.answer, "Não há runbook para esse serviço.");
    assert.ok(result.trace.some((event) => event.type === "observation" && /error/i.test(event.content)));
  } finally {
    store.close();
  }
});
