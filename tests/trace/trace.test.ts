import assert from "node:assert/strict";
import test from "node:test";
import {
  formatTrace,
  sanitizeTraceEvent,
  sanitizeTraceText,
  traceEventSchema,
  type TraceEvent,
} from "../../src/../src/trace/trace.ts";

test("accepts all typed trace event variants and requires tool arguments for actions", () => {
  const events: TraceEvent[] = [
    { type: "thought", content: "Check current alerts" },
    { type: "action", content: "List active alerts", tool: "list_alerts", args: { status: "firing" } },
    { type: "observation", content: "Two alerts are firing" },
    { type: "plan", content: "Inspect alert, then open incident" },
    { type: "critique", content: "The service name is confirmed" },
    { type: "answer", content: "Two alerts are firing" },
  ];

  for (const event of events) {
    assert.deepEqual(traceEventSchema.parse(event), event);
  }
  assert.throws(() => traceEventSchema.parse({ type: "action", content: "Call tool" }));
});

test("formats events in input order with stable action arguments", () => {
  const events: TraceEvent[] = [
    { type: "thought", content: "Inspect alerts" },
    { type: "action", content: "List alerts", tool: "list_alerts", args: { status: "firing" } },
    { type: "observation", content: "One alert is firing" },
  ];

  assert.equal(
    formatTrace(events),
    [
      "1. thought: Inspect alerts",
      '2. action: List alerts [tool=list_alerts args={"status":"firing"}]',
      "3. observation: One alert is firing",
    ].join("\n"),
  );
});

test("redacts secret values from trace text and action arguments", () => {
  const secret = "sk-private-value";
  const events: TraceEvent[] = [
    {
      type: "action",
      content: `Using api_key=${secret}`,
      tool: "open_incidente",
      args: { title: "Alert", apiKey: secret, nested: { password: "hidden" } },
    },
  ];

  const formatted = formatTrace(events);
  assert.equal(formatted.includes(secret), false);
  assert.match(formatted, /\[REDACTED\]/);
  assert.equal(sanitizeTraceText(`token: ${secret}`).includes(secret), false);
  assert.doesNotMatch(
    sanitizeTraceText(`Tool returned {"apiKey":"${secret}","password":"hidden"}`),
    /sk-private-value|hidden/,
  );
});

test("accepts an optional graph node on every event type", () => {
  const nodes = ["context", "router", "react", "plan-and-execute", "reflection", "response"];
  for (const node of nodes) {
    assert.equal(traceEventSchema.parse({ type: "thought", content: "x", node }).node, node);
  }
  assert.equal(traceEventSchema.parse({ type: "answer", content: "x" }).node, undefined);
  assert.throws(() => traceEventSchema.parse({ type: "answer", content: "x", node: "roteador" }));
});

test("validates the route event", () => {
  const event = {
    type: "route",
    node: "router",
    content: "Route react (router): pergunta direta",
    route: "react",
    reason: "pergunta direta",
    source: "router",
  };
  assert.deepEqual(traceEventSchema.parse(event), event);
  assert.throws(() => traceEventSchema.parse({ ...event, route: "planExecute" }));
  assert.throws(() => traceEventSchema.parse({ ...event, source: "model" }));
  assert.throws(() => traceEventSchema.parse({ ...event, reason: "  " }));
});

test("redacts secrets in route reasons", () => {
  const event = sanitizeTraceEvent({
    type: "route",
    node: "router",
    content: "Route react (fallback): Router failed: api_key=abc123",
    route: "react",
    reason: "Router failed: api_key=abc123",
    source: "fallback",
  });
  assert.equal(event.type === "route" ? event.reason : "", "Router failed: api_key=[REDACTED]");
  assert.doesNotMatch(event.content, /abc123/);
});

test("validates the model fallback event and rejects malformed ones", () => {
  const event: TraceEvent = {
    type: "fallback",
    node: "react",
    content: "Model fallback p/one → r/two: Primary failed after 2 attempts: HTTP 503",
    primaryModel: "p/one",
    reserveModel: "r/two",
    reason: "Primary failed after 2 attempts: HTTP 503",
  };
  assert.deepEqual(traceEventSchema.parse(event), event);
  assert.throws(() => traceEventSchema.parse({ ...event, primaryModel: "" }));
  assert.throws(() => traceEventSchema.parse({ ...event, reserveModel: "" }));
  assert.throws(() => traceEventSchema.parse({ ...event, reason: " " }));
  assert.throws(() => traceEventSchema.parse({ ...event, reason: "x".repeat(301) }));
  assert.throws(() => traceEventSchema.parse({ ...event, extra: true }));
});

test("redacts secrets in fallback reasons and formats the event", () => {
  const event = sanitizeTraceEvent({
    type: "fallback",
    node: "router",
    content: "Model fallback p → r: boom api_key=sk-123",
    primaryModel: "p",
    reserveModel: "r",
    reason: "boom api_key=sk-123",
  });
  assert.equal(event.type === "fallback" ? event.reason : "", "boom api_key=[REDACTED]");
  assert.doesNotMatch(event.content, /sk-123/);
  assert.equal(formatTrace([event]), "1. fallback: Model fallback p → r: boom api_key=[REDACTED]");
});

test("redacting already-redacted text is a no-op", () => {
  const once = sanitizeTraceText("boom api_key=sk-123 token: abc");
  assert.equal(sanitizeTraceText(once), once);
});

test("validates the approval event", () => {
  const event = {
    type: "approval",
    node: "react",
    content: "Aguardando aprovação: Resolver o incidente incident-001",
    approvalId: "6f1c2a9e-3b7d-4c51-9a0e-2f8d4b6c1e73",
    decision: "pending",
    tool: "resolve_incident",
    target: "incident-001",
  };
  assert.equal(traceEventSchema.safeParse(event).success, true);
  for (const decision of ["approved", "denied"]) {
    assert.equal(traceEventSchema.safeParse({ ...event, decision }).success, true, decision);
  }
  assert.equal(traceEventSchema.safeParse({ ...event, decision: "maybe" }).success, false);
  assert.equal(traceEventSchema.safeParse({ ...event, tool: "open_incidente" }).success, false);
  assert.equal(traceEventSchema.safeParse({ ...event, approvalId: "x" }).success, false);
  assert.equal(traceEventSchema.safeParse({ ...event, target: "" }).success, false);
});
