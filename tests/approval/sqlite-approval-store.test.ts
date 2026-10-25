import assert from "node:assert/strict";
import test from "node:test";
import { SqliteApprovalStore } from "../../src/approval/sqlite-approval-store.ts";
import type { NewApproval } from "../../src/approval/approval-store.ts";

const ID = "5b7e1c2a-9e3b-4d51-8a0e-2f8d4b6c1e73";
const REQ = "8d0c2a9e-3b7d-4c51-9a0e-2f8d4b6c1e74";
const DECIDER = "0b9a4c21-7e55-4d2f-8a61-3c0f9e7b2d44";
const t0 = new Date("2026-10-24T13:05:00.000Z");
const at = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);

const input = (overrides: Partial<NewApproval> = {}): NewApproval => ({
  id: ID,
  requestId: REQ,
  conversationId: "conv-1",
  tool: "resolve_incident",
  args: { id: "incident-001" },
  target: "incident-001",
  description: "Resolver o incidente incident-001",
  route: "react",
  modelUsed: "openrouter/free",
  ...overrides,
});

function store(context: { after: (fn: () => void) => void }) {
  const approvals = new SqliteApprovalStore(":memory:");
  context.after(() => approvals.close());
  return approvals;
}

test("create stores a pending approval that expires in 15 minutes", (context) => {
  const approvals = store(context);
  const { approval, route, modelUsed } = approvals.create(input(), t0);
  assert.deepEqual(approval, {
    id: ID,
    requestId: REQ,
    conversationId: "conv-1",
    tool: "resolve_incident",
    args: { id: "incident-001" },
    target: "incident-001",
    description: "Resolver o incidente incident-001",
    status: "pending",
    createdAt: "2026-10-24T13:05:00.000Z",
    expiresAt: "2026-10-24T13:20:00.000Z",
    decidedAt: null,
  });
  assert.equal(route, "react");
  assert.equal(modelUsed, "openrouter/free");
});

test("get validates the id, misses unknown ids and reports stale rows as expired", (context) => {
  const approvals = store(context);
  approvals.create(input(), t0);
  assert.throws(() => approvals.get("not-a-uuid", t0), { name: "DomainValidationError" });
  assert.equal(approvals.get(DECIDER, t0), undefined);
  assert.equal(approvals.get(ID, at(14))?.approval.status, "pending");
  assert.equal(approvals.get(ID, at(15))?.approval.status, "expired");
});

test("the first claim wins; later claims are refused", (context) => {
  const approvals = store(context);
  approvals.create(input(), t0);
  const first = approvals.claim(ID, "approved", DECIDER, at(1));
  assert.equal(first.ok, true);
  assert.equal(first.ok && first.stored.approval.status, "approved");
  assert.equal(first.ok && first.stored.approval.decidedAt, "2026-10-24T13:06:00.000Z");
  const row = approvals._db.prepare("SELECT decision_request_id FROM approvals WHERE id = ?").get(ID);
  assert.equal(row?.decision_request_id, DECIDER);

  assert.deepEqual(approvals.claim(ID, "denied", REQ, at(2)), { ok: false, reason: "not_pending" });
  assert.equal(approvals.get(ID, at(2))?.approval.status, "approved");
});

test("expired and unknown approvals cannot be claimed", (context) => {
  const approvals = store(context);
  approvals.create(input(), t0);
  assert.deepEqual(approvals.claim(ID, "approved", DECIDER, at(15)), { ok: false, reason: "not_pending" });
  assert.deepEqual(approvals.claim(DECIDER, "approved", DECIDER, t0), { ok: false, reason: "unknown" });
  assert.throws(() => approvals.claim("bad", "approved", DECIDER, t0), { name: "DomainValidationError" });
});

test("only resolve_incident proposals are accepted", (context) => {
  const approvals = store(context);
  assert.throws(() => approvals.create(input({ tool: "open_incidente" as "resolve_incident" }), t0));
  assert.throws(() => approvals.create(input({ args: { id: "" } }), t0));
});
