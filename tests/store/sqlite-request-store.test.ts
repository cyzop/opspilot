import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildRequestRecord, chosenRoute, requestRecordSchema, type RequestRecord } from "../../src/store/request-store.ts";
import { SqliteRequestStore } from "../../src/store/sqlite-request-store.ts";
import type { TraceEvent } from "../../src/trace/trace.ts";

const ID = "6f1c2a9e-3b7d-4c51-9a0e-2f8d4b6c1e73";
const OTHER = "0b9a4c21-7e55-4d2f-8a61-3c0f9e7b2d44";

const trace: TraceEvent[] = [
  { type: "summarize", node: "context", content: "ok", status: "ok", messages: 8, estimatedTokens: 40 },
  { type: "route", node: "router", content: "Route react (router): direta", route: "react", reason: "direta", source: "router" },
  { type: "fallback", node: "react", content: "Model fallback p → r: x", primaryModel: "p", reserveModel: "r", reason: "x" },
  { type: "answer", node: "react", content: "Dois alertas" },
];

function okRecord(id = ID): RequestRecord {
  return buildRequestRecord({
    id,
    startedAt: new Date("2026-10-24T10:00:00.000Z"),
    finishedAt: new Date("2026-10-24T10:00:01.250Z"),
    status: 200,
    errorCategory: null,
    conversationId: "c-1",
    userId: "u-1",
    requestedRoute: null,
    trace,
    metrics: { llmCalls: 2, latencyMs: 1200, promptTokens: 300, historyMessages: 8, modelUsed: "r" },
  });
}

test("buildRequestRecord computes duration and the route that answered", () => {
  const record = okRecord();
  assert.equal(record.durationMs, 1250);
  assert.equal(record.route, "react");
  assert.equal(chosenRoute([]), null);
  assert.equal(chosenRoute([
    { type: "route", content: "a", route: "plan-and-execute", reason: "a", source: "router" },
    { type: "route", content: "b", route: "react", reason: "b", source: "fallback" },
  ]), "react");
  assert.throws(() => buildRequestRecord({ ...okRecord(), startedAt: new Date(), finishedAt: new Date(), trace: [], status: 500, errorCategory: null, metrics: null } as never));
});

test("records and returns the request with its trace in seq order", (context) => {
  const store = new SqliteRequestStore(":memory:");
  context.after(() => store.close());
  store.record(okRecord(), trace);
  const failed = buildRequestRecord({
    id: OTHER,
    startedAt: new Date("2026-10-24T10:00:00.000Z"),
    finishedAt: new Date("2026-10-24T10:00:00.010Z"),
    status: 503,
    errorCategory: "model_unavailable",
    conversationId: null,
    userId: null,
    requestedRoute: "plan-and-execute",
    trace: [],
    metrics: null,
  });
  store.record(failed, []);

  assert.deepEqual(store.get(ID), { record: okRecord(), trace });
  assert.deepEqual(store.get(OTHER), { record: failed, trace: [] });
  assert.equal(store.get("00000000-0000-4000-8000-000000000000"), undefined);
  assert.throws(() => store.get("not-a-uuid"), { name: "DomainValidationError" });
});

test("a duplicate id rolls back and keeps the first record intact", (context) => {
  const store = new SqliteRequestStore(":memory:");
  context.after(() => store.close());
  store.record(okRecord(), trace);
  assert.throws(() => store.record(okRecord(), [{ type: "answer", content: "outra" }]));
  assert.deepEqual(store.get(ID)?.trace, trace);
});

test("listSince returns records started at or after the cutoff, oldest first", (context) => {
  const store = new SqliteRequestStore(":memory:");
  context.after(() => store.close());
  store.record(okRecord(), trace); // 2026-10-24T10:00:00.000Z
  const later = buildRequestRecord({
    id: OTHER,
    startedAt: new Date("2026-10-24T12:00:00.000Z"),
    finishedAt: new Date("2026-10-24T12:00:00.100Z"),
    status: 503,
    errorCategory: "model_unavailable",
    conversationId: null,
    userId: null,
    requestedRoute: null,
    trace: [],
    metrics: null,
  });
  store.record(later, []);
  assert.deepEqual(store.listSince(new Date("2026-10-24T09:00:00.000Z")).map(({ id }) => id), [ID, OTHER]);
  assert.deepEqual(store.listSince(new Date("2026-10-24T10:00:00.000Z")).map(({ id }) => id), [ID, OTHER]);
  assert.deepEqual(store.listSince(new Date("2026-10-24T11:00:00.000Z")).map(({ id }) => id), [OTHER]);
  assert.deepEqual(store.listSince(new Date("2026-10-25T00:00:00.000Z")), []);
});

test("data survives closing and reopening the database file", () => {
  const dir = mkdtempSync(join(tmpdir(), "opspilot-requests-"));
  const path = join(dir, "requests.db");
  try {
    const first = new SqliteRequestStore(path);
    first.record(okRecord(), trace);
    first.close();
    const second = new SqliteRequestStore(path);
    assert.deepEqual(second.get(ID), { record: okRecord(), trace });
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a 202 pending-approval record has metrics and no error category", () => {
  const base = okRecord();
  assert.equal(requestRecordSchema.safeParse({ ...base, status: 202 }).success, true);
  assert.equal(requestRecordSchema.safeParse({ ...base, status: 202, errorCategory: "internal" }).success, false);
  assert.equal(requestRecordSchema.safeParse({ ...base, status: 202, metrics: null }).success, false);
  assert.equal(requestRecordSchema.safeParse({ ...base, status: 500, errorCategory: "internal", metrics: null }).success, true);
  assert.equal(requestRecordSchema.safeParse({ ...base, status: 500, errorCategory: null, metrics: null }).success, false);
});
