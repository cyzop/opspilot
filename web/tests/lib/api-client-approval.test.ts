import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient } from "../../src/lib/api-client.ts";
import { approvalBody, decisionBody, fakeFetch, pendingBody } from "../helpers/fixtures.ts";

test("chat 202 becomes an approval result", async () => {
  const { fetch } = fakeFetch([{ status: 202, body: pendingBody() }]);
  const result = await createApiClient({ baseUrl: "http://api.test", fetch }).chat({ message: "Resolva" });
  assert.equal(result.ok && result.kind, "approval");
  assert.equal(result.ok && result.kind === "approval" && result.body.approval.target, "incident-001");
});

test("decide posts the decision to the approval route", async () => {
  const { fetch, calls } = fakeFetch([{ status: 200, body: decisionBody("approved") }]);
  const result = await createApiClient({ baseUrl: "http://api.test/", fetch }).decide("appr-1", "approve");
  assert.equal(result.ok && result.kind, "decided");
  assert.equal(calls[0]?.url, "http://api.test/approvals/appr-1/decision");
  assert.equal(calls[0]?.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { decision: "approve" });
});

test("a 409 decision is not_pending and carries the stored approval", async () => {
  const { fetch } = fakeFetch([{ status: 409, body: { error: "Approval is no longer pending", approval: approvalBody({ status: "expired" }) } }]);
  const result = await createApiClient({ baseUrl: "http://api.test", fetch }).decide("appr-1", "deny");
  assert.equal(result.ok && result.kind, "not_pending");
  assert.equal(result.ok && result.kind === "not_pending" && result.approval?.status, "expired");
});

test("a 404 decision is not_pending without an approval", async () => {
  const { fetch } = fakeFetch([{ status: 404, body: { error: "Unknown approval" } }]);
  const result = await createApiClient({ baseUrl: "http://api.test", fetch }).decide("appr-1", "approve");
  assert.deepEqual(result, { ok: true, kind: "not_pending" });
});

test("a decision that cannot reach the API is a network error", async () => {
  const { fetch } = fakeFetch([{ status: 0 }]);
  const result = await createApiClient({ baseUrl: "http://api.test", fetch }).decide("appr-1", "approve");
  assert.equal(!result.ok && result.error.kind, "network");
});

test("getApproval reads the approval by id", async () => {
  const { fetch, calls } = fakeFetch([{ status: 200, body: { approval: approvalBody(), requestId: "req-9" } }]);
  const result = await createApiClient({ baseUrl: "http://api.test", fetch }).getApproval("appr-1");
  assert.equal(result.ok && result.approval.status, "pending");
  assert.equal(calls[0]?.url, "http://api.test/approvals/appr-1");
});
