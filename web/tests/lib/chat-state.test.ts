import assert from "node:assert/strict";
import test from "node:test";
import { chatAnswerSchema } from "../../src/lib/api-schemas.ts";
import { chatReducer, initialChatState, isBusy, LOST_CONVERSATION_NOTICE, type ChatState } from "../../src/lib/chat-state.ts";
import { answerBody } from "../helpers/fixtures.ts";

const answer = chatAnswerSchema.parse(answerBody());
const send = (state: ChatState, id: string, message = "Quais alertas?") => chatReducer(state, { type: "send", id, message });

test("send adds a sending turn with the trimmed message", () => {
  const state = send(initialChatState, "t1", "  Quais alertas?  ");
  assert.deepEqual(state.turns, [{ id: "t1", message: "Quais alertas?", status: "sending" }]);
  assert.equal(isBusy(state), true);
});

test("send ignores blank messages and messages while busy", () => {
  assert.equal(send(initialChatState, "t1", "   \n "), initialChatState);
  const busy = send(initialChatState, "t1");
  assert.equal(send(busy, "t2"), busy);
});

test("answered stores the answer and the conversation id", () => {
  const state = chatReducer(send(initialChatState, "t1"), { type: "answered", id: "t1", body: answer });
  const turn = state.turns[0];
  assert.equal(turn?.status, "answered");
  assert.equal(turn?.status === "answered" && turn.answer, "Há 2 alertas ativos.");
  assert.equal(turn?.status === "answered" && turn.requestId, "req-1");
  assert.equal(turn?.status === "answered" && turn.trace.length, 4);
  assert.equal(state.conversationId, "conv-1");
  assert.equal(isBusy(state), false);
});

test("failed keeps the message and retry sends it again", () => {
  const failed = chatReducer(send(initialChatState, "t1"), {
    type: "failed",
    id: "t1",
    error: { kind: "network", message: "Não foi possível conectar à API (rede ou CORS)." },
  });
  assert.deepEqual(failed.turns[0], {
    id: "t1",
    message: "Quais alertas?",
    status: "failed",
    error: { kind: "network", message: "Não foi possível conectar à API (rede ou CORS)." },
  });
  const retried = chatReducer(failed, { type: "retry", id: "t1" });
  assert.deepEqual(retried.turns[0], { id: "t1", message: "Quais alertas?", status: "sending" });
});

test("a 404 on a known conversation starts a new one with a notice", () => {
  const answered = chatReducer(send(initialChatState, "t1"), { type: "answered", id: "t1", body: answer });
  const failed = chatReducer(send(answered, "t2"), {
    type: "failed",
    id: "t2",
    error: { kind: "http", status: 404, message: "A conversa não existe mais na API." },
  });
  assert.equal(failed.conversationId, null);
  assert.equal(failed.notice, LOST_CONVERSATION_NOTICE);
});

test("newConversation clears turns and conversation id, but not while busy", () => {
  const answered = chatReducer(send(initialChatState, "t1"), { type: "answered", id: "t1", body: answer });
  assert.deepEqual(chatReducer(answered, { type: "newConversation" }), initialChatState);
  const busy = send(answered, "t2");
  assert.equal(chatReducer(busy, { type: "newConversation" }), busy);
});

test("actions for unknown turns change nothing", () => {
  const state = send(initialChatState, "t1");
  assert.equal(chatReducer(state, { type: "answered", id: "nope", body: answer }), state);
  assert.equal(chatReducer(state, { type: "retry", id: "t1" }), state);
});
