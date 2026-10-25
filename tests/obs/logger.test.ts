import assert from "node:assert/strict";
import test from "node:test";
import { formatLogLine, logEvent, setLogWriter } from "../../src/obs/logger.ts";
import { runWithRequestContext } from "../../src/obs/request-context.ts";

const REQUEST_ID = "6f1c2a9e-3b7d-4c51-9a0e-2f8d4b6c1e73";

function capture(context: test.TestContext) {
  const lines: string[] = [];
  context.after(setLogWriter((line) => lines.push(line)));
  return { lines, parsed: () => lines.map((line) => JSON.parse(line) as Record<string, unknown>) };
}

test("formats one JSON line with a single trailing newline", () => {
  const line = formatLogLine({ ts: "2026-10-24T00:00:00.000Z", level: "info", event: "request_started" });
  assert.ok(line.endsWith("\n"));
  assert.equal(line.indexOf("\n"), line.length - 1);
  assert.deepEqual(JSON.parse(line), { ts: "2026-10-24T00:00:00.000Z", level: "info", event: "request_started" });
});

test("adds ts, level, event and the request id from the context", (context) => {
  const { parsed } = capture(context);
  logEvent("info", "request_started");
  runWithRequestContext({ requestId: REQUEST_ID }, () => logEvent("warn", "router_fallback", { node: "router", route: "react" }));
  const [outside, inside] = parsed();
  assert.equal(outside?.requestId, undefined);
  assert.equal(outside?.event, "request_started");
  assert.ok(!Number.isNaN(Date.parse(String(outside?.ts))));
  assert.deepEqual({ ...inside, ts: undefined }, {
    ts: undefined, level: "warn", event: "router_fallback", requestId: REQUEST_ID, node: "router", route: "react",
  });
});

test("drops content fields and invalid values instead of writing or throwing", (context) => {
  const { parsed } = capture(context);
  logEvent("info", "trace_event", {
    seq: -1,
    type: "answer",
    content: "segredo",
    reason: "x",
    answer: "y",
    args: { a: 1 },
    message: "m",
    userId: "u-1",
  } as never);
  const [line] = parsed();
  assert.deepEqual(Object.keys(line ?? {}).sort(), ["event", "level", "ts", "type"]);
});

test("a failing writer never propagates", (context) => {
  context.after(setLogWriter(() => { throw new Error("disk full"); }));
  assert.doesNotThrow(() => logEvent("error", "persistence_failed", { errorCategory: "persistence" }));
});

test("the default writer targets stderr, never stdout", (context) => {
  const restore = setLogWriter(() => {});
  restore(); // back to the default writer
  const stderr = context.mock.method(process.stderr, "write", () => true);
  const stdout = context.mock.method(process.stdout, "write", () => true);
  logEvent("info", "request_started");
  stderr.mock.restore();
  stdout.mock.restore();
  assert.equal(stderr.mock.callCount(), 1);
  assert.equal(stdout.mock.callCount(), 0);
});
