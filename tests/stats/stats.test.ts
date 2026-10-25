import assert from "node:assert/strict";
import test from "node:test";
import {
  computeStats,
  isFreeModel,
  loadModelPrices,
  parseSince,
  percentile,
} from "../../src/stats/stats.ts";
import { buildRequestRecord, type RequestRecord } from "../../src/store/request-store.ts";
import type { TraceEvent } from "../../src/trace/trace.ts";

const route = (name: "react" | "plan-and-execute"): TraceEvent[] => [
  { type: "route", content: name, route: name, reason: "fake", source: "router" },
];

let counter = 0;
function record(options: {
  durationMs: number;
  status?: number;
  routeName?: "react" | "plan-and-execute" | null;
  model?: string;
  promptTokens?: number | null;
}): RequestRecord {
  counter += 1;
  const status = options.status ?? 200;
  const startedAt = new Date("2026-10-24T10:00:00.000Z");
  return buildRequestRecord({
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    startedAt,
    finishedAt: new Date(startedAt.getTime() + options.durationMs),
    status,
    errorCategory: status < 300 ? null : "model_unavailable",
    conversationId: null,
    userId: null,
    requestedRoute: null,
    trace: options.routeName ? route(options.routeName) : [],
    metrics: status < 300
      ? { llmCalls: 1, latencyMs: options.durationMs, promptTokens: options.promptTokens === undefined ? 100 : options.promptTokens, historyMessages: 0, modelUsed: options.model ?? "openrouter/free" }
      : null,
  });
}

test("parseSince accepts minutes, hours and days and rejects the rest", () => {
  assert.equal(parseSince(undefined), 24 * 3_600_000);
  assert.equal(parseSince("30m"), 30 * 60_000);
  assert.equal(parseSince("24h"), 24 * 3_600_000);
  assert.equal(parseSince("7d"), 7 * 86_400_000);
  for (const bad of ["", "24", "h", "0h", "-1h", "1w", "1.5h", "366d"]) {
    assert.throws(() => parseSince(bad), { name: "DomainValidationError" }, bad);
  }
});

test("percentile uses the nearest-rank method", () => {
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([7], 95), 7);
  const values = Array.from({ length: 100 }, (_, index) => index + 1);
  assert.equal(percentile(values, 50), 50);
  assert.equal(percentile(values, 95), 95);
  assert.equal(percentile([30, 10, 20], 50), 20);
});

test("free models cost zero: ':free' suffix and openrouter/free", () => {
  assert.equal(isFreeModel("meta-llama/llama-3.3-70b-instruct:free"), true);
  assert.equal(isFreeModel("openrouter/free"), true);
  assert.equal(isFreeModel("openai/gpt-4o-mini"), false);
});

test("loadModelPrices reads USD per million prompt tokens and rejects bad JSON", () => {
  assert.deepEqual(loadModelPrices({}), {});
  assert.deepEqual(loadModelPrices({ OPSPILOT_MODEL_PRICES: '{"openai/gpt-4o-mini":0.15}' }), { "openai/gpt-4o-mini": 0.15 });
  assert.throws(() => loadModelPrices({ OPSPILOT_MODEL_PRICES: "{" }), { name: "ConfigurationError" });
  assert.throws(() => loadModelPrices({ OPSPILOT_MODEL_PRICES: '{"m":-1}' }), { name: "ConfigurationError" });
});

test("computeStats totals, errors, tokens, cost, percentiles and groups", () => {
  const records = [
    record({ durationMs: 100, routeName: "react", model: "openrouter/free", promptTokens: 1_000 }),
    record({ durationMs: 200, routeName: "react", model: "openai/gpt-4o-mini", promptTokens: 2_000_000 }),
    record({ durationMs: 300, routeName: "plan-and-execute", model: "x/unpriced", promptTokens: 500 }),
    record({ durationMs: 400, routeName: "plan-and-execute", model: "openai/gpt-4o-mini", promptTokens: null }),
    record({ durationMs: 50, status: 503, routeName: "react" }),
    record({ durationMs: 10, status: 503, routeName: null }),
  ];
  const stats = computeStats(records, { "openai/gpt-4o-mini": 0.15 });

  assert.equal(stats.total, 6);
  assert.equal(stats.errors, 2);
  assert.equal(stats.errorRate, 2 / 6);
  assert.equal(stats.promptTokens, 2_001_500);
  assert.equal(stats.requestsWithoutTokens, 1);
  assert.equal(stats.costUsd, 0.3); // 2M tokens × $0.15/M; free = 0; unpriced excluded
  assert.deepEqual(stats.unpricedModels, ["x/unpriced"]);
  assert.deepEqual(stats.latencyMs, { p50: 100, p95: 400 });

  assert.deepEqual(Object.keys(stats.byRoute).sort(), ["none", "plan-and-execute", "react"]);
  assert.deepEqual(stats.byRoute.react, {
    total: 3, errors: 1, promptTokens: 2_001_000, costUsd: 0.3, latencyMs: { p50: 100, p95: 200 },
  });
  assert.equal(stats.byRoute.none?.errors, 1);

  assert.deepEqual(Object.keys(stats.byModel).sort(), ["openai/gpt-4o-mini", "openrouter/free", "unknown", "x/unpriced"]);
  assert.equal(stats.byModel["openrouter/free"]?.costUsd, 0);
  assert.equal(stats.byModel["x/unpriced"]?.costUsd, null);
  assert.equal(stats.byModel.unknown?.total, 2);
  assert.equal(stats.byModel.unknown?.errors, 2);
});

test("computeStats on no requests returns zeros and null percentiles", () => {
  const stats = computeStats([], {});
  assert.equal(stats.total, 0);
  assert.equal(stats.errorRate, 0);
  assert.equal(stats.costUsd, 0);
  assert.deepEqual(stats.latencyMs, { p50: null, p95: null });
  assert.deepEqual(stats.byRoute, {});
});

test("a 202 pending approval is not an error", () => {
  const stats = computeStats([record({ durationMs: 10, status: 202 }), record({ durationMs: 20 })], {});
  assert.equal(stats.total, 2);
  assert.equal(stats.errors, 0);
});
