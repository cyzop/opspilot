import assert from "node:assert/strict";
import test from "node:test";
import { chatAnswerSchema, traceEventSchema } from "../../src/lib/api-schemas.ts";
import { answerBody } from "../helpers/fixtures.ts";

const everyKind = [
  { type: "thought", content: "t", node: "react" },
  { type: "action", content: "a", tool: "list_alerts", args: {}, node: "react" },
  { type: "observation", content: "o" },
  { type: "plan", content: "p" },
  { type: "critique", content: "c" },
  { type: "answer", content: "r" },
  { type: "summarize", content: "s", status: "ok", messages: 3, estimatedTokens: null },
  { type: "route", content: "r", route: "react", reason: "x", source: "router" },
  { type: "fallback", content: "f", primaryModel: "a", reserveModel: "b", reason: "x" },
  { type: "approval", content: "a", approvalId: "id", decision: "pending", tool: "resolve_incident", target: "incident-001" },
];

test("every trace kind the API produces parses", () => {
  for (const event of everyKind) assert.equal(traceEventSchema.safeParse(event).success, true, event.type);
  assert.equal(chatAnswerSchema.safeParse(answerBody({ trace: everyKind })).success, true);
});

test("an unknown kind passes through", () => {
  assert.equal(traceEventSchema.safeParse({ type: "novo", anything: [1, 2] }).success, true);
});

test("a known kind with a wrong field type is rejected", () => {
  assert.equal(traceEventSchema.safeParse({ type: "action", content: "a", tool: 1, args: {} }).success, false);
  assert.equal(traceEventSchema.safeParse({ type: "approval", content: "a", approvalId: "id", decision: "maybe", tool: "t", target: "x" }).success, false);
  assert.equal(chatAnswerSchema.safeParse(answerBody({ trace: [{ type: "route", content: "r" }] })).success, false);
});
