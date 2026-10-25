import assert from "node:assert/strict";
import test from "node:test";
import { approvalRequiredFor, HTTP_APPROVAL_POLICY, runWithApprovalPolicy } from "../../src/approval/approval-context.ts";

test("no policy outside /chat: nothing is gated", () => {
  assert.equal(approvalRequiredFor("resolve_incident"), false);
});

test("the HTTP policy gates only resolve_incident", () => {
  runWithApprovalPolicy(HTTP_APPROVAL_POLICY, () => {
    assert.equal(approvalRequiredFor("resolve_incident"), true);
    assert.equal(approvalRequiredFor("open_incidente"), false);
    assert.equal(approvalRequiredFor("list_alerts"), false);
  });
});

test("the policy follows its own async run and does not leak", async () => {
  const seen: boolean[] = [];
  await Promise.all([
    runWithApprovalPolicy(HTTP_APPROVAL_POLICY, async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      seen.push(approvalRequiredFor("resolve_incident"));
    }),
    (async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      seen.push(approvalRequiredFor("resolve_incident"));
    })(),
  ]);
  assert.deepEqual(seen.sort(), [false, true]);
  assert.equal(approvalRequiredFor("resolve_incident"), false);
});
