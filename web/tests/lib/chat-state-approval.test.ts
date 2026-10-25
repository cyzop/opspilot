import assert from "node:assert/strict";
import test from "node:test";
import { approvalSchema, decisionResponseSchema, pendingApprovalSchema } from "../../src/lib/api-schemas.ts";
import { chatReducer, initialChatState, isBusy, type ChatState, type Turn } from "../../src/lib/chat-state.ts";
import { approvalBody, decisionBody, pendingBody } from "../helpers/fixtures.ts";

const pending = pendingApprovalSchema.parse(pendingBody());

function awaiting(): ChatState {
  const sent = chatReducer(initialChatState, { type: "send", id: "t1", message: "Resolva o incidente" });
  return chatReducer(sent, { type: "awaitingApproval", id: "t1", body: pending });
}

const turn = (state: ChatState): Turn | undefined => state.turns[0];

test("awaitingApproval keeps the approval, trace and conversation, and is not busy", () => {
  const state = awaiting();
  const current = turn(state);
  assert.equal(current?.status, "awaiting_approval");
  assert.equal(current?.status === "awaiting_approval" && current.decision, "idle");
  assert.equal(current?.status === "awaiting_approval" && current.trace.length, 2);
  assert.equal(state.conversationId, "conv-1");
  assert.equal(isBusy(state), false);
});

test("a decision is sent once: sending is busy and a second decisionSent is ignored", () => {
  const sending = chatReducer(awaiting(), { type: "decisionSent", id: "t1" });
  assert.equal(isBusy(sending), true);
  assert.equal(chatReducer(sending, { type: "decisionSent", id: "t1" }), sending);
});

test("decided keeps the card and adds the final answer", () => {
  const sending = chatReducer(awaiting(), { type: "decisionSent", id: "t1" });
  for (const decision of ["approved", "denied"] as const) {
    const state = chatReducer(sending, { type: "decided", id: "t1", body: decisionResponseSchema.parse(decisionBody(decision)) });
    const current = turn(state);
    assert.equal(current?.status === "awaiting_approval" && current.decision, decision);
    assert.equal(current?.status === "awaiting_approval" && current.approval.status, decision);
    assert.match(current?.status === "awaiting_approval" ? current.final?.answer ?? "" : "", /incident-001/);
    assert.equal(isBusy(state), false);
  }
});

test("decisionRefused marks the card as no longer pending", () => {
  const sending = chatReducer(awaiting(), { type: "decisionSent", id: "t1" });
  const state = chatReducer(sending, { type: "decisionRefused", id: "t1", approval: approvalSchema.parse(approvalBody({ status: "expired" })) });
  const current = turn(state);
  assert.equal(current?.status === "awaiting_approval" && current.decision, "not_pending");
  assert.equal(current?.status === "awaiting_approval" && current.approval.status, "expired");
});

test("decisionFailed reopens the card with the error, and a new decision clears it", () => {
  const sending = chatReducer(awaiting(), { type: "decisionSent", id: "t1" });
  const failed = chatReducer(sending, { type: "decisionFailed", id: "t1", error: { kind: "network", message: "x" } });
  const current = turn(failed);
  assert.equal(current?.status === "awaiting_approval" && current.decision, "idle");
  assert.equal(current?.status === "awaiting_approval" && current.decisionError?.kind, "network");
  const again = turn(chatReducer(failed, { type: "decisionSent", id: "t1" }));
  assert.equal(again?.status === "awaiting_approval" && again.decisionError, undefined);
});

test("an already expired approval arrives as not_pending", () => {
  const sent = chatReducer(initialChatState, { type: "send", id: "t1", message: "Resolva" });
  const body = pendingApprovalSchema.parse(pendingBody({ approval: approvalBody({ status: "expired" }) }));
  const current = turn(chatReducer(sent, { type: "awaitingApproval", id: "t1", body }));
  assert.equal(current?.status === "awaiting_approval" && current.decision, "not_pending");
});
