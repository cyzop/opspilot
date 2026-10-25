import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { tool } from "@langchain/core/tools";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { ChatOpenAI } from "@langchain/openai";
import { ModelUnavailableError, StrategyLimitError } from "../../src/domain/errors.ts";
import {
  createModel,
  DEFAULT_MODEL_ATTEMPTS,
  readModelSettings,
  type OpenRouterEnvironment,
} from "../../src/llm/model.ts";
import { createFakeChatModel, httpError, type FakeScript } from "../helpers/fake-chat-model.ts";
import { captureLogs } from "../helpers/capture-logs.ts";

const ENV = { OPENROUTER_API_KEY: "test-only-key", OPENROUTER_MODEL: "p/one", OPENROUTER_MODEL_FALLBACK: "r/two" };

function resilient(primary: FakeScript, reserve: FakeScript | null, attempts = 1) {
  const fakes = { primary: createFakeChatModel("p/one", primary), reserve: createFakeChatModel("r/two", reserve ?? ["unused"]) };
  const built: string[] = [];
  const env = reserve === null ? { ...ENV, OPENROUTER_MODEL_FALLBACK: "" } : ENV;
  const model = createModel(env, {
    attempts,
    buildChatModel: (name): BaseChatModel => {
      built.push(name);
      return name === "p/one" ? fakes.primary.model : fakes.reserve.model;
    },
  });
  return { model, built, primaryCalls: fakes.primary.calls, reserveCalls: fakes.reserve.calls };
}

const text = (message: { content: unknown }) => String(message.content);

test("configures OpenRouter primary and reserve with zero temperature and no internal retries", () => {
  const model = createModel({ ...ENV, OPENROUTER_MODEL: "openrouter/test-model" });
  for (const [inner, name] of [[model.primaryModel, "openrouter/test-model"], [model.reserveModel, "r/two"]] as const) {
    const chat = inner as ChatOpenAI;
    assert.equal(chat.model, name);
    assert.equal(chat.temperature, 0);
    assert.equal(chat.clientConfig.baseURL, "https://openrouter.ai/api/v1");
    assert.equal((chat.caller as unknown as { maxRetries: number }).maxRetries, 0);
  }
  assert.equal(createModel({ ...ENV, OPENROUTER_MODEL_FALLBACK: "" }).reserveModel, undefined);
});

test("uses 2 attempts per model by default", () => {
  assert.equal(DEFAULT_MODEL_ATTEMPTS, 2);
  assert.equal(createModel(ENV).attempts, 2);
  assert.throws(() => createModel(ENV, { attempts: 0 }));
});

test("rejects missing or blank OpenRouter configuration before a request", () => {
  const invalidEnvironments: OpenRouterEnvironment[] = [
    {},
    { OPENROUTER_API_KEY: "key", OPENROUTER_MODEL: "" },
    { OPENROUTER_API_KEY: " ", OPENROUTER_MODEL: "model" },
    { OPENROUTER_API_KEY: "key", OPENROUTER_MODEL: "  " },
  ];
  for (const env of invalidEnvironments) {
    assert.throws(() => createModel(env), { name: "ConfigurationError" });
    assert.throws(() => readModelSettings(env), { name: "ConfigurationError" });
  }
});

test("reads the optional reserve model and ignores blank or duplicate values", () => {
  const base = { OPENROUTER_API_KEY: " key ", OPENROUTER_MODEL: " p/one " };
  assert.deepEqual(readModelSettings(base), { apiKey: "key", primary: "p/one", reserve: null, reserveIgnored: null });
  assert.deepEqual(readModelSettings({ ...base, OPENROUTER_MODEL_FALLBACK: "   " }).reserve, null);
  assert.deepEqual(readModelSettings({ ...base, OPENROUTER_MODEL_FALLBACK: " p/one" }), {
    apiKey: "key",
    primary: "p/one",
    reserve: null,
    reserveIgnored: "same-as-primary",
  });
  assert.equal(readModelSettings({ ...base, OPENROUTER_MODEL_FALLBACK: " r/two " }).reserve, "r/two");
});

test("lenient settings never throw and name an unconfigured primary", () => {
  assert.equal(readModelSettings({}, { lenient: true }).primary, "unconfigured");
  assert.equal(readModelSettings({ OPENROUTER_MODEL: "p/one" }, { lenient: true }).primary, "p/one");
});

test("a transient primary failure is recovered by retry without the reserve", async () => {
  const { model, primaryCalls, reserveCalls } = resilient([httpError(503), "ok"], ["reserva"], 2);
  assert.equal(text(await model.invoke("oi")), "ok");
  assert.equal(primaryCalls.length, 2);
  assert.equal(reserveCalls.length, 0);
});

test("a primary that keeps failing is served by the reserve", async () => {
  const { model, primaryCalls, reserveCalls } = resilient([httpError(503)], ["reserva"]);
  assert.equal(text(await model.invoke("oi")), "reserva");
  assert.equal(primaryCalls.length, 1);
  assert.equal(reserveCalls.length, 1);
});

test("a permanent error skips primary retries; the reserve is retried too", async () => {
  const { model, primaryCalls, reserveCalls } = resilient([httpError(400)], [httpError(503), "reserva"], 2);
  assert.equal(text(await model.invoke("oi")), "reserva");
  assert.equal(primaryCalls.length, 1);
  assert.equal(reserveCalls.length, 2);
});

test("budget errors pass through without retry or reserve", async () => {
  const limit = new StrategyLimitError("limit reached");
  const { model, primaryCalls, reserveCalls } = resilient([limit], ["reserva"], 2);
  await assert.rejects(model.invoke("oi"), (error) => error === limit);
  assert.equal(primaryCalls.length, 1);
  assert.equal(reserveCalls.length, 0);
});

test("without a reserve, an exhausted primary is a ModelUnavailableError", async () => {
  const cause = httpError(503);
  const { model, built } = resilient([cause], null);
  await assert.rejects(model.invoke("oi"), (error) => {
    assert.ok(error instanceof ModelUnavailableError);
    assert.equal(error.message, "Language models are unavailable; try again later.");
    assert.equal(error.cause, cause);
    return true;
  });
  assert.deepEqual(built, ["p/one"]);
});

test("both models failing is a ModelUnavailableError", async () => {
  const { model } = resilient([httpError(503)], [httpError(502)]);
  await assert.rejects(model.invoke("oi"), ModelUnavailableError);
});

test("a reserve equal to the primary is never built", async () => {
  const built: string[] = [];
  const fake = createFakeChatModel("p/one", [httpError(503)]);
  const model = createModel({ ...ENV, OPENROUTER_MODEL_FALLBACK: "p/one" }, {
    attempts: 1,
    buildChatModel: (name) => { built.push(name); return fake.model; },
  });
  await assert.rejects(model.invoke("oi"), ModelUnavailableError);
  assert.deepEqual(built, ["p/one"]);
  assert.equal(fake.calls.length, 1);
});

test("structured output and bound tools follow the same retry and reserve rules", async () => {
  const structured = resilient([httpError(503)], [{ route: "react", reason: "fake" }]);
  const schema = z.object({ route: z.string(), reason: z.string() });
  assert.deepEqual(await structured.model.withStructuredOutput(schema).invoke("oi"), { route: "react", reason: "fake" });
  assert.deepEqual(structured.reserveCalls.map(({ method }) => method), ["structured"]);

  const tools = resilient([httpError(503)], ["com ferramentas"]);
  const echo = tool(async () => "x", { name: "echo", description: "echo", schema: z.object({}) });
  const bound = tools.model.bindTools([echo]);
  assert.equal(text(await bound.invoke("oi")), "com ferramentas");
  assert.deepEqual(tools.primaryCalls.map(({ method }) => method), ["tools"]);
  assert.deepEqual(tools.reserveCalls.map(({ method }) => method), ["tools"]);
});

test("a switched call reports one redacted fallback in the current scope and logs it", async (context) => {
  const { collectModelFallbacks } = await import("../../src/llm/model-events.ts");
  const logs = captureLogs(context);
  const { model } = resilient([new Error("api_key=sk-123 boom")], ["reserva"]);
  const { fallbacks } = await collectModelFallbacks(() => model.invoke("oi"));
  assert.equal(fallbacks.length, 1);
  const [report] = fallbacks;
  assert.equal(report?.primaryModel, "p/one");
  assert.equal(report?.reserveModel, "r/two");
  assert.match(report?.reason ?? "", /^Primary failed after 1 attempt: /);
  assert.doesNotMatch(report?.reason ?? "", /sk-123/);
  assert.ok((report?.reason.length ?? 0) <= 300);
  const switches = logs.named("model_fallback");
  assert.equal(switches.length, 1);
  assert.deepEqual({ level: switches[0]?.level, primaryModel: switches[0]?.primaryModel, reserveModel: switches[0]?.reserveModel }, { level: "warn", primaryModel: "p/one", reserveModel: "r/two" });
  assert.doesNotMatch(logs.lines.join(""), /sk-123|boom/);

  const long = resilient([new Error("x".repeat(500))], ["reserva"]);
  const longRun = await collectModelFallbacks(() => long.model.invoke("oi"));
  assert.equal(longRun.fallbacks[0]?.reason.length, 300);
});

test("no fallback is reported when the primary recovers, one when both fail", async (context) => {
  const { collectModelFallbacks } = await import("../../src/llm/model-events.ts");
  captureLogs(context);
  const healthy = resilient(["ok"], ["reserva"]);
  assert.equal((await collectModelFallbacks(() => healthy.model.invoke("oi"))).fallbacks.length, 0);

  const down = resilient([httpError(503)], [httpError(503)]);
  const { value, fallbacks } = await collectModelFallbacks(() => down.model.invoke("oi").catch((error: unknown) => error));
  assert.ok(value instanceof ModelUnavailableError);
  assert.equal(fallbacks.length, 1);
});

test("describes the reserve configuration for the startup log", async () => {
  const { describeModelFallback } = await import("../../src/llm/model.ts");
  const base = { OPENROUTER_API_KEY: "k", OPENROUTER_MODEL: "p/one" };
  assert.equal(describeModelFallback(readModelSettings({ ...base, OPENROUTER_MODEL_FALLBACK: "r/two" })), "Model fallback enabled: p/one → r/two");
  assert.equal(describeModelFallback(readModelSettings(base)), "Model fallback not configured: retries only on p/one");
  assert.equal(
    describeModelFallback(readModelSettings({ ...base, OPENROUTER_MODEL_FALLBACK: "p/one" })),
    "Model fallback ignored: OPENROUTER_MODEL_FALLBACK equals OPENROUTER_MODEL",
  );
});
