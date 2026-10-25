import assert from "node:assert/strict";
import test from "node:test";
import type { StrategyRegistry } from "../../src/agentes/index.ts";
import { DEFAULT_CONTEXT_BUDGET } from "../../src/context/context-builder.ts";
import { createProductionGraph, resolveModelUsed } from "../../src/graph/production-graph.ts";
import type { HistorySummarizer } from "../../src/context/conversation-history.ts";
import { ModelUnavailableError } from "../../src/domain/errors.ts";
import { reportModelFallback } from "../../src/llm/model-events.ts";
import type { Route } from "../../src/graph/router.ts";
import { SqliteConversationStore } from "../../src/store/sqlite-conversation-store.ts";
import type { StrategyResult, TraceEvent } from "../../src/trace/trace.ts";
import { createFakeHistorySummarizer } from "../helpers/fake-history-summarizer.ts";
import { createFakeRouter, type FakeRouterBehavior } from "../helpers/fake-router.ts";
import { FakeReasoningStrategy } from "../helpers/fake-reasoning-strategy.ts";
import { captureLogs } from "../helpers/capture-logs.ts";

function strategyFor(label: string, extraTrace: StrategyResult["trace"] = []): FakeReasoningStrategy {
  return new FakeReasoningStrategy(() => ({
    answer: `${label} answer`,
    trace: [...extraTrace, { type: "answer", content: `${label} answer` }],
    metrics: { llmCalls: 2, latencyMs: 3 },
  }));
}

function setup(behavior: FakeRouterBehavior, options: { pairs?: number; summarizer?: HistorySummarizer } = {}) {
  const store = new SqliteConversationStore(":memory:");
  const conversationId = store.create().id;
  for (let index = 0; index < (options.pairs ?? 0); index += 1) {
    store.append(conversationId, [
      { role: "user", content: `Question ${index}` },
      { role: "assistant", content: `Answer ${index}` },
    ]);
  }
  const strategies = {
    react: strategyFor("react"),
    "plan-and-execute": strategyFor("plan", [{ type: "plan", content: "[]" }]),
    reflection: strategyFor("reflection", [{ type: "critique", content: "approved" }]),
  };
  const resolved: Array<{ name: string; reflect: boolean }> = [];
  const registry: StrategyRegistry = {
    resolve(name, reflect = false) {
      resolved.push({ name, reflect });
      if (reflect) return strategies.reflection;
      if (name === "react") return strategies.react;
      if (name === "plan-and-execute") return strategies["plan-and-execute"];
      throw new Error(`Unexpected strategy ${name}`);
    },
  };
  const fakeRouter = createFakeRouter(behavior);
  const graph = createProductionGraph({
    registry,
    conversationStore: store,
    summarizer: options.summarizer ?? createFakeHistorySummarizer().summarizer,
    router: fakeRouter.router,
    contextBudget: DEFAULT_CONTEXT_BUDGET,
    primaryModel: "p/one",
  });
  return { store, conversationId, strategies, resolved, fakeRouter, graph };
}

for (const route of ["react", "plan-and-execute", "reflection"] as const satisfies readonly Route[]) {
  test(`routes to ${route} and runs only that strategy`, async (context) => {
    const { store, conversationId, strategies, fakeRouter, graph } = setup(route);
    context.after(() => store.close());

    const output = await graph.run({ message: "Qual o status?", conversationId });
    for (const [name, strategy] of Object.entries(strategies)) {
      assert.equal(strategy.inputs.length, name === route ? 1 : 0, `${name} runs only when routed`);
    }
    assert.equal(fakeRouter.calls.length, 1);
    const routes = output.trace.filter((event) => event.type === "route");
    assert.equal(routes.length, 1);
    assert.equal(routes[0]?.type === "route" ? routes[0].route : "", route);
    assert.equal(routes[0]?.type === "route" ? routes[0].source : "", "router");
    assert.equal(output.metrics.llmCalls, 3);
    assert.ok(output.answer.endsWith("answer"));
  });
}

test("router failure or invalid output falls back to react", async (context) => {
  const logs = captureLogs(context);
  for (const behavior of [() => new Error("boom api_key=abc"), () => ({ route: "other" })]) {
    const { store, conversationId, strategies, graph } = setup(behavior);
    const output = await graph.run({ message: "Qual o status?", conversationId });
    const route = output.trace.find((event) => event.type === "route");
    assert.equal(strategies.react.inputs.length, 1);
    assert.equal(route?.type === "route" ? route.source : "", "fallback");
    assert.match(route?.type === "route" ? route.reason : "", /^Router failed/);
    assert.doesNotMatch(JSON.stringify(output.trace), /abc"|api_key=abc/);
    store.close();
  }
  assert.equal(logs.named("router_fallback").length, 2);
});

test("an override skips the router", async (context) => {
  const { store, conversationId, strategies, fakeRouter, graph } = setup("react");
  context.after(() => store.close());
  const output = await graph.run({ message: "Planeje", conversationId, requestedRoute: "plan-and-execute" });
  assert.equal(fakeRouter.calls.length, 0);
  assert.equal(strategies["plan-and-execute"].inputs.length, 1);
  const route = output.trace.find((event) => event.type === "route");
  assert.equal(route?.type === "route" ? route.source : "", "override");
  assert.equal(output.metrics.llmCalls, 2);
});

test("every event carries its node, in the order summarize, route, strategy", async (context) => {
  const { store, conversationId, graph } = setup("reflection", { pairs: 8 });
  context.after(() => store.close());
  const output = await graph.run({ message: "O que está pendente?", conversationId });

  assert.deepEqual(output.trace.map(({ type, node }) => `${type}:${node}`), [
    "summarize:context",
    "route:router",
    "critique:reflection",
    "answer:reflection",
  ]);
  assert.ok(output.trace.every((event) => event.node !== undefined));
});

test("the strategy receives the built context and the router sees it too", async (context) => {
  const { store, conversationId, strategies, fakeRouter, graph } = setup("react");
  context.after(() => store.close());
  await graph.run({ message: "Status do checkout?", conversationId });
  assert.match(strategies.react.inputs[0] ?? "", /^System instructions:/);
  assert.ok(strategies.react.inputs[0]?.endsWith("User: Status do checkout?"));
  assert.equal(fakeRouter.calls[0], strategies.react.inputs[0]);
});

for (const failing of ["plan-and-execute", "reflection"] as const) {
  test(`a failing ${failing} strategy falls back to react with a second route event`, async (context) => {
    const logs = captureLogs(context);
    const { store, conversationId, strategies, graph } = setup(failing);
    context.after(() => store.close());
    const broken = new FakeReasoningStrategy(() => {
      throw new Error("Failed to parse. Text: \"\" api_key=abc123");
    });
    strategies[failing].run = broken.run.bind(broken);

    const output = await graph.run({ message: "Monte o plano do checkout", conversationId });

    assert.equal(strategies.react.inputs.length, 1);
    assert.equal(output.answer, "react answer");
    assert.deepEqual(output.trace.map(({ type, node }) => `${type}:${node}`), [
      "route:router",
      `route:${failing}`,
      "answer:react",
    ]);
    const fallback = output.trace[1];
    assert.equal(fallback?.type === "route" ? fallback.route : "", "react");
    assert.equal(fallback?.type === "route" ? fallback.source : "", "fallback");
    assert.match(fallback?.type === "route" ? fallback.reason : "", new RegExp(`^Strategy ${failing} failed`));
    assert.doesNotMatch(JSON.stringify(output.trace), /abc123/);
    const strategyFallbacks = logs.named("strategy_fallback");
    assert.equal(strategyFallbacks.length, 1);
    assert.equal(strategyFallbacks[0]?.node, failing);
    assert.equal(strategyFallbacks[0]?.route, "react");
    assert.doesNotMatch(logs.lines.join(""), /abc123/);
  });
}

test("a failing react strategy is not retried and the error propagates", async (context) => {
  const { store, conversationId, strategies, graph } = setup("react");
  context.after(() => store.close());
  const broken = new FakeReasoningStrategy(() => {
    throw new Error("react down");
  });
  strategies.react.run = broken.run.bind(broken);
  await assert.rejects(graph.run({ message: "Status?", conversationId }), /react down/);
});

const switched = (reason: string) => reportModelFallback({ primaryModel: "p/one", reserveModel: "r/two", reason });

test("model fallbacks become fallback events tagged with the node that made the call", async (context) => {
  const summarizer: HistorySummarizer = async () => {
    switched("summarizer switched");
    return "resumo";
  };
  const { store, conversationId, strategies, graph } = setup(() => {
    switched("router switched");
    return { route: "plan-and-execute", reason: "fake router" };
  }, { pairs: 8, summarizer });
  context.after(() => store.close());
  const plan = new FakeReasoningStrategy(() => {
    switched("plan switched");
    return { answer: "plan answer", trace: [{ type: "answer", content: "plan answer" }], metrics: { llmCalls: 1, latencyMs: 1 } };
  });
  strategies["plan-and-execute"].run = plan.run.bind(plan);

  const output = await graph.run({ message: "Planeje", conversationId });

  assert.deepEqual(output.trace.map(({ type, node }) => `${type}:${node}`), [
    "fallback:context",
    "summarize:context",
    "fallback:router",
    "route:router",
    "fallback:plan-and-execute",
    "answer:plan-and-execute",
  ]);
  const event = output.trace.find((item) => item.type === "fallback" && item.node === "router");
  assert.deepEqual(event, {
    type: "fallback",
    node: "router",
    primaryModel: "p/one",
    reserveModel: "r/two",
    reason: "router switched",
    content: "Model fallback p/one → r/two: router switched",
  });
  assert.equal(output.metrics.modelUsed, "r/two");
});

test("a switch inside the ReAct fallback of a failing strategy is tagged react", async (context) => {
  captureLogs(context);
  const { store, conversationId, strategies, graph } = setup("plan-and-execute");
  context.after(() => store.close());
  const broken = new FakeReasoningStrategy(() => {
    switched("plan switched");
    throw new Error("plan broke");
  });
  strategies["plan-and-execute"].run = broken.run.bind(broken);
  const react = new FakeReasoningStrategy(() => {
    switched("react switched");
    return { answer: "react answer", trace: [{ type: "answer", content: "react answer" }], metrics: { llmCalls: 1, latencyMs: 1 } };
  });
  strategies.react.run = react.run.bind(react);

  const output = await graph.run({ message: "Planeje", conversationId });
  assert.deepEqual(output.trace.map(({ type, node }) => `${type}:${node}`), [
    "route:router",
    "fallback:plan-and-execute",
    "route:plan-and-execute",
    "fallback:react",
    "answer:react",
  ]);
});

test("a healthy turn has no fallback events and reports the primary model", async (context) => {
  const { store, conversationId, graph } = setup("react");
  context.after(() => store.close());
  const output = await graph.run({ message: "Status?", conversationId });
  assert.equal(output.trace.some((event) => event.type === "fallback"), false);
  assert.equal(output.metrics.modelUsed, "p/one");
});

test("resolveModelUsed picks the reserve when any call switched", () => {
  const answer: TraceEvent = { type: "answer", content: "ok" };
  const fallback = (reserveModel: string): TraceEvent => ({
    type: "fallback", content: "x", primaryModel: "p/one", reserveModel, reason: "x",
  });
  assert.equal(resolveModelUsed([answer], "p/one"), "p/one");
  assert.equal(resolveModelUsed([fallback("r/two"), answer, fallback("r/other")], "p/one"), "r/two");
});

test("model outages in the router or summarizer keep their auxiliary fallbacks", async (context) => {
  captureLogs(context);
  const down = new ModelUnavailableError("Language models are unavailable; try again later.");
  const summarizer: HistorySummarizer = async () => { throw down; };
  const { store, conversationId, strategies, graph } = setup(() => down, { pairs: 8, summarizer });
  context.after(() => store.close());

  const output = await graph.run({ message: "Status?", conversationId });

  assert.equal(strategies.react.inputs.length, 1);
  const route = output.trace.find((event) => event.type === "route");
  assert.equal(route?.type === "route" ? route.source : "", "fallback");
  const summarize = output.trace.find((event) => event.type === "summarize");
  assert.equal(summarize?.type === "summarize" ? summarize.status : "", "failed");
});

test("a model outage in the answering strategy propagates as ModelUnavailableError", async (context) => {
  captureLogs(context);
  const { store, conversationId, strategies, graph } = setup("plan-and-execute");
  context.after(() => store.close());
  const down = () => { throw new ModelUnavailableError("Language models are unavailable; try again later."); };
  for (const name of ["plan-and-execute", "react"] as const) {
    const broken = new FakeReasoningStrategy(down);
    strategies[name].run = broken.run.bind(broken);
  }
  await assert.rejects(graph.run({ message: "Planeje", conversationId }), ModelUnavailableError);
});

test("onTrace sees the growing trace; the last call equals the output trace", async (context) => {
  const { store, conversationId, graph } = setup("react", { pairs: 8 });
  context.after(() => store.close());
  const seen: TraceEvent[][] = [];
  const output = await graph.run({ message: "Status?", conversationId }, { onTrace: (trace) => seen.push(trace) });
  assert.ok(seen.length >= 3);
  assert.deepEqual(seen.at(-1), output.trace);
});

test("when the answering strategy fails, the last observed trace keeps earlier nodes", async (context) => {
  const { store, conversationId, strategies, graph } = setup("react", { pairs: 8 });
  context.after(() => store.close());
  const broken = new FakeReasoningStrategy(() => { throw new ModelUnavailableError("down"); });
  strategies.react.run = broken.run.bind(broken);
  let last: TraceEvent[] = [];
  await assert.rejects(graph.run({ message: "Status?", conversationId }, { onTrace: (trace) => { last = trace; } }), ModelUnavailableError);
  assert.deepEqual(last.map(({ type, node }) => `${type}:${node}`), ["summarize:context", "route:router"]);
});

test("a paused tool is not a strategy failure: no ReAct fallback, full trace kept", async (context) => {
  const { ApprovalRequiredError } = await import("../../src/approval/approval-errors.ts");
  const { proposeResolution } = await import("../../src/approval/approval-service.ts");
  const { store, conversationId, strategies, graph } = setup("plan-and-execute");
  context.after(() => store.close());
  const pausing = new FakeReasoningStrategy(() => {
    const error = new ApprovalRequiredError(proposeResolution("incident-001"));
    error.trace = [{ type: "action", content: "Resolve", tool: "resolve_incident", args: { id: "incident-001" } }];
    error.metrics = { llmCalls: 1, latencyMs: 4, promptTokens: 100 };
    throw error;
  });
  strategies["plan-and-execute"].run = pausing.run.bind(pausing);
  const logs = captureLogs(context);

  const error = await graph.run({ message: "Resolva incident-001", conversationId }).then(() => undefined, (caught: unknown) => caught);
  assert.ok(error instanceof ApprovalRequiredError);
  assert.equal(strategies.react.inputs.length, 0, "no fallback to react");
  assert.doesNotMatch(logs.lines.join(""), /strategy_fallback/);
  assert.equal(error.route, "plan-and-execute");
  assert.deepEqual(error.trace.map(({ type, node }) => `${type}:${node}`), ["route:router", "action:plan-and-execute"]);
  assert.equal(error.metrics?.llmCalls, 2, "the routing model call counts");
});
