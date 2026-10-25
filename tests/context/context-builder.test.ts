import assert from "node:assert/strict";
import test from "node:test";
import {
  buildContext,
  DEFAULT_CONTEXT_BUDGET,
  loadContextBudget,
  SYSTEM_PROMPT,
  UNLIMITED_CONTEXT_BUDGET,
  type ContextBudget,
} from "../../src/context/context-builder.ts";
import { estimateTokens } from "../../src/context/tokens.ts";
import { ConfigurationError } from "../../src/domain/errors.ts";
import type { ConversationMessage } from "../../src/domain/domain.ts";

function messages(count: number): ConversationMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    conversationId: "conversation-1",
    role: index % 2 === 0 ? "user" : "assistant",
    content: `mensagem ${index + 1}`,
    createdAt: "2026-10-19T12:00:00.000Z",
  }));
}

const HISTORY_HEADER = "Conversation history (oldest first):";
const MEMORY_HEADER = "Semantic memory (relevant facts):";

function budget(overrides: Partial<ContextBudget>): ContextBudget {
  return { ...UNLIMITED_CONTEXT_BUDGET, ...overrides };
}

test("renders sections in the order system, summary, history, memories, message", () => {
  const built = buildContext({
    message: "O que está pendente?",
    history: messages(2),
    summary: "- Decisão: escalar pagamentos",
    memories: [{ fact: "Prefere alertas críticos primeiro", score: 0.9 }],
    budget: UNLIMITED_CONTEXT_BUDGET,
  });

  assert.equal(built.prompt, [
    "System instructions:",
    SYSTEM_PROMPT,
    "Conversation summary (older messages):",
    "- Decisão: escalar pagamentos",
    HISTORY_HEADER,
    "User: mensagem 1",
    "Assistant: mensagem 2",
    MEMORY_HEADER,
    "- Prefere alertas críticos primeiro",
    "Current message:",
    "User: O que está pendente?",
  ].join("\n"));
  assert.equal(
    built.prompt,
    [built.sections.system, built.sections.summary, built.sections.history, built.sections.memory, built.sections.message]
      .join("\n"),
  );
  for (const report of Object.values(built.report)) {
    assert.equal(report.droppedItems, 0);
    assert.equal(report.overBudget, false);
  }
});

test("message-only input keeps the system instruction and the message", () => {
  const built = buildContext({ message: "Status?", budget: DEFAULT_CONTEXT_BUDGET });
  assert.equal(built.prompt, `System instructions:\n${SYSTEM_PROMPT}\nCurrent message:\nUser: Status?`);
  assert.equal(built.sections.history, "");
  assert.equal(built.sections.summary, "");
  assert.equal(built.sections.memory, "");
});

test("zero budgets omit history and memories but never the system, summary or message", () => {
  const built = buildContext({
    message: "Status?",
    history: messages(4),
    summary: "Resumo",
    memories: [{ fact: "Fato", score: 1 }],
    budget: { system: 0, summary: 0, history: 0, memories: 0 },
  });
  assert.ok(built.prompt.startsWith(`System instructions:\n${SYSTEM_PROMPT}`));
  assert.match(built.prompt, /Conversation summary \(older messages\):\nResumo/);
  assert.doesNotMatch(built.prompt, /Conversation history|Semantic memory/);
  assert.ok(built.prompt.endsWith("Current message:\nUser: Status?"));
  assert.equal(built.report.history.droppedItems, 4);
  assert.equal(built.report.memories.droppedItems, 1);
  assert.equal(built.report.system.overBudget, true);
  assert.equal(built.report.summary.overBudget, true);
});

test("history drops the oldest whole messages first", () => {
  const history = messages(6);
  const fitsTwo = estimateTokens([HISTORY_HEADER, "User: mensagem 5", "Assistant: mensagem 6"].join("\n"));
  const built = buildContext({ message: "Agora?", history, budget: budget({ history: fitsTwo }) });

  assert.equal(built.sections.history, [HISTORY_HEADER, "User: mensagem 5", "Assistant: mensagem 6"].join("\n"));
  assert.equal(built.report.history.droppedItems, 4);
  assert.ok(built.report.history.keptTokens <= fitsTwo);
  assert.ok(built.report.history.droppedTokens > 0);
  assert.equal(built.report.history.cut, "oldest-first");
});

test("history is omitted when the newest message alone exceeds the budget", () => {
  const history = [...messages(2), { ...messages(3)[2]!, content: "x".repeat(400) }];
  const built = buildContext({ message: "Agora?", history, budget: budget({ history: 50 }) });
  assert.equal(built.sections.history, "");
  assert.equal(built.report.history.droppedItems, 3);
});

test("memories drop the lowest-score facts first and keep score order", () => {
  const memories = [
    { fact: "fato A", score: 0.9 },
    { fact: "fato B", score: 0.5 },
    { fact: "fato C", score: 0.8 },
    { fact: "fato D", score: 0.2 },
  ];
  const fitsTwo = estimateTokens([MEMORY_HEADER, "- fato A", "- fato C"].join("\n"));
  const built = buildContext({ message: "Agora?", memories, budget: budget({ memories: fitsTwo }) });

  assert.equal(built.sections.memory, [MEMORY_HEADER, "- fato A", "- fato C"].join("\n"));
  assert.equal(built.report.memories.droppedItems, 2);
  assert.equal(built.report.memories.cut, "lowest-score-first");
});

test("memory ties keep the earlier-recalled fact", () => {
  const memories = [{ fact: "primeiro", score: 0.7 }, { fact: "segundo", score: 0.7 }];
  const fitsOne = estimateTokens([MEMORY_HEADER, "- primeiro"].join("\n"));
  const built = buildContext({ message: "Agora?", memories, budget: budget({ memories: fitsOne }) });
  assert.equal(built.sections.memory, [MEMORY_HEADER, "- primeiro"].join("\n"));
});

test("memories are omitted when even the best fact does not fit", () => {
  const built = buildContext({
    message: "Agora?",
    memories: [{ fact: "um fato relativamente longo para o teto", score: 1 }],
    budget: budget({ memories: 5 }),
  });
  assert.equal(built.sections.memory, "");
  assert.equal(built.report.memories.droppedItems, 1);
});

test("system and summary are never cut and are flagged over budget", () => {
  const summary = Array.from({ length: 5 }, (_, index) => `- pendência ${index + 1}: ${"detalhe ".repeat(10).trimEnd()}`).join("\n");
  const built = buildContext({ message: "Agora?", summary, budget: budget({ summary: 20, system: 10 }) });
  assert.equal(built.sections.summary, `Conversation summary (older messages):\n${summary}`);
  assert.equal(built.sections.system, `System instructions:\n${SYSTEM_PROMPT}`);
  assert.equal(built.report.summary.overBudget, true);
  assert.equal(built.report.summary.droppedItems, 0);
  assert.equal(built.report.system.overBudget, true);
  assert.equal(built.report.summary.cut, "never");
});

test("tetos baixos cortam na ordem certa", () => {
  const memories = [
    { fact: "baixo", score: 0.1 },
    { fact: "alto", score: 0.95 },
    { fact: "medio", score: 0.5 },
  ];
  const history = messages(5);
  const historyBudget = estimateTokens([HISTORY_HEADER, "User: mensagem 5"].join("\n"));
  const memoryBudget = estimateTokens([MEMORY_HEADER, "- alto"].join("\n"));
  const built = buildContext({
    message: "O que faço agora?",
    history,
    summary: "Resumo longo ".repeat(40),
    memories,
    budget: { system: 1, summary: 1, history: historyBudget, memories: memoryBudget },
  });

  assert.equal(built.sections.history, [HISTORY_HEADER, "User: mensagem 5"].join("\n"));
  assert.equal(built.sections.memory, [MEMORY_HEADER, "- alto"].join("\n"));
  assert.ok(built.sections.summary.includes("Resumo longo ".repeat(40).trim()));
  assert.ok(built.prompt.includes(SYSTEM_PROMPT));
  assert.ok(built.prompt.endsWith("Current message:\nUser: O que faço agora?"));
  const order = ["System instructions:", "Conversation summary", HISTORY_HEADER, MEMORY_HEADER, "Current message:"]
    .map((marker) => built.prompt.indexOf(marker));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.ok(estimateTokens(built.sections.history) <= historyBudget);
  assert.ok(estimateTokens(built.sections.memory) <= memoryBudget);
});

test("loadContextBudget applies defaults and environment overrides", () => {
  assert.deepEqual(loadContextBudget({}), DEFAULT_CONTEXT_BUDGET);
  assert.deepEqual(DEFAULT_CONTEXT_BUDGET, { system: 400, summary: 200, history: 1200, memories: 300 });
  assert.deepEqual(
    loadContextBudget({ CONTEXT_BUDGET_HISTORY: "500", CONTEXT_BUDGET_SUMMARY: "0" }),
    { system: 400, summary: 0, history: 500, memories: 300 },
  );
});

test("loadContextBudget rejects invalid values naming the variable", () => {
  for (const value of ["-1", "abc", "1.5", ""]) {
    assert.throws(
      () => loadContextBudget({ CONTEXT_BUDGET_MEMORIES: value }),
      (error: unknown) => error instanceof ConfigurationError && /CONTEXT_BUDGET_MEMORIES/.test(error.message),
    );
  }
});
