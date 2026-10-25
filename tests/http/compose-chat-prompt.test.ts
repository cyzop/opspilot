import assert from "node:assert/strict";
import test from "node:test";
import { SYSTEM_PROMPT } from "../../src/context/context-builder.ts";
import type { ConversationMessage } from "../../src/domain/domain.ts";
import { composeChatContext, composeChatPrompt } from "../../src/http/compose-chat-prompt.ts";

function message(id: number, role: ConversationMessage["role"], content: string): ConversationMessage {
  return { id, conversationId: "conversation-1", role, content, createdAt: "2026-01-01T00:00:00.000Z" };
}

const history: ConversationMessage[] = [
  message(1, "user", "Earlier question"),
  message(2, "assistant", "Earlier answer"),
];
const facts = ["Deployments happen on Tuesdays."];
const systemSection = `System instructions:\n${SYSTEM_PROMPT}`;

test("composeChatContext prompt matches composeChatPrompt for every combination", () => {
  const combinations: Array<[ConversationMessage[], string[], string | null]> = [
    [[], [], null],
    [history, [], null],
    [[], facts, null],
    [[], [], "Resumo"],
    [history, facts, "Resumo"],
  ];
  for (const [turnHistory, memoryFacts, summary] of combinations) {
    const context = composeChatContext("Now?", turnHistory, memoryFacts, summary);
    assert.equal(context.prompt, composeChatPrompt("Now?", turnHistory, memoryFacts, summary));
    assert.equal(
      context.prompt,
      [
        context.sections.system,
        context.sections.summary,
        context.sections.history,
        context.sections.memory,
        context.sections.message,
      ].filter(Boolean).join("\n"),
    );
  }
});

test("composeChatContext always frames the message after the system instruction", () => {
  const context = composeChatContext("Now?", []);
  assert.equal(context.prompt, `${systemSection}\nCurrent message:\nUser: Now?`);
  assert.equal(context.sections.history, "");
  assert.equal(context.sections.memory, "");
  assert.equal(context.sections.summary, "");
});

test("composeChatContext renders every history message it receives", () => {
  const longHistory: ConversationMessage[] = Array.from({ length: 14 }, (_, index) =>
    message(index + 1, index % 2 === 0 ? "user" : "assistant", `message-${index}`));
  const { sections } = composeChatContext("Now?", longHistory, facts);

  assert.match(sections.memory, /^Semantic memory \(relevant facts\):/);
  assert.match(sections.history, /^Conversation history \(oldest first\):/);
  assert.match(sections.message, /^Current message:/);
  assert.match(sections.history, /message-0\b/);
  assert.match(sections.history, /message-13\b/);
});

test("composeChatContext orders system, summary, history, memories, message", () => {
  const prompt = composeChatContext("Now?", history, facts, "Decisão: escalar pagamentos.").prompt;
  const positions = [
    "System instructions:",
    "Conversation summary (older messages):\nDecisão: escalar pagamentos.",
    "Conversation history (oldest first):",
    "Semantic memory (relevant facts):",
    "Current message:\nUser: Now?",
  ].map((marker) => prompt.indexOf(marker));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
});
