import assert from "node:assert/strict";
import test from "node:test";
import { decisionOutcome, pendingTraceEvent, proposeResolution } from "../../src/approval/approval-service.ts";
import type { Approval } from "../../src/approval/approval-store.ts";
import { traceEventSchema } from "../../src/trace/trace.ts";

const approval: Approval = {
  id: "5b7e1c2a-9e3b-4d51-8a0e-2f8d4b6c1e73",
  requestId: "8d0c2a9e-3b7d-4c51-9a0e-2f8d4b6c1e74",
  conversationId: "conv-1",
  tool: "resolve_incident",
  args: { id: "incident-001" },
  target: "incident-001",
  description: "Resolver o incidente incident-001",
  status: "approved",
  createdAt: "2026-10-24T13:05:00.000Z",
  expiresAt: "2026-10-24T13:20:00.000Z",
  decidedAt: "2026-10-24T13:06:00.000Z",
};

test("proposeResolution describes the paused call", () => {
  assert.deepEqual(proposeResolution("incident-001"), {
    tool: "resolve_incident",
    args: { id: "incident-001" },
    target: "incident-001",
    description: "Resolver o incidente incident-001",
  });
});

test("pendingTraceEvent is a valid approval(pending) event on the given node", () => {
  const event = pendingTraceEvent({ ...approval, status: "pending", decidedAt: null }, "react");
  assert.deepEqual(traceEventSchema.parse(event), {
    type: "approval",
    node: "react",
    content: "Aguardando aprovação: Resolver o incidente incident-001",
    approvalId: approval.id,
    decision: "pending",
    tool: "resolve_incident",
    target: "incident-001",
  });
});

test("an approved, successful resolution answers and records action + observation", () => {
  const outcome = decisionOutcome({ approval, decision: "approved", execution: { ok: true, result: { id: "incident-001", status: "resolved" } } });
  assert.equal(outcome.answer, "Incidente incident-001 resolvido após aprovação do operador.");
  assert.deepEqual(outcome.trace.map(({ type, node }) => `${type}:${node}`), ["approval:response", "action:response", "observation:response", "answer:response"]);
  assert.match(outcome.trace[2]?.content ?? "", /"status":"resolved"/);
  for (const event of outcome.trace) traceEventSchema.parse(event);
});

test("an approved resolution that fails says so", () => {
  const outcome = decisionOutcome({ approval, decision: "approved", execution: { ok: false, message: "Unknown incident: incident-001" } });
  assert.match(outcome.answer, /foi aprovada, mas falhou: Unknown incident/);
  assert.match(outcome.trace[2]?.content ?? "", /Tool returned an error: Unknown incident/);
});

test("a denied resolution changes nothing", () => {
  const outcome = decisionOutcome({ approval: { ...approval, status: "denied" }, decision: "denied" });
  assert.equal(outcome.answer, "Resolução do incidente incident-001 negada pelo operador; nada foi alterado.");
  assert.deepEqual(outcome.trace.map(({ type }) => type), ["approval", "answer"]);
  assert.equal(outcome.trace[0]?.type === "approval" && outcome.trace[0].decision, "denied");
});
