import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  planHistory,
  prepareConversationHistory,
} from "../../src/context/conversation-history.ts";
import type { ConversationMessage } from "../../src/domain/domain.ts";
import { estimateTokens } from "../../src/context/tokens.ts";
import { SqliteConversationStore } from "../../src/store/sqlite-conversation-store.ts";
import { createFakeHistorySummarizer } from "../helpers/fake-history-summarizer.ts";
import { captureLogs } from "../helpers/capture-logs.ts";

function messages(count: number): ConversationMessage[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    conversationId: "conversation-1",
    role: index % 2 === 0 ? "user" : "assistant",
    content: `message-${index + 1}`,
    createdAt: "2026-10-19T12:00:00.000Z",
  }));
}

function seededStore(pairs: number, content = (index: number, role: string) => `${role} ${index}`) {
  const store = new SqliteConversationStore(":memory:");
  const conversation = store.create();
  for (let index = 0; index < pairs; index += 1) {
    store.append(conversation.id, [
      { role: "user", content: content(index, "user") },
      { role: "assistant", content: content(index, "assistant") },
    ]);
  }
  return { store, conversationId: conversation.id };
}

const now = () => new Date("2026-10-19T12:00:00.000Z");

test("planHistory keeps everything verbatim up to the recent window", () => {
  for (const count of [0, 5, 8]) {
    const plan = planHistory(messages(count));
    assert.equal(plan.recent.length, count);
    assert.deepEqual(plan.pending, []);
    assert.deepEqual(plan.batch, []);
  }
});

test("planHistory keeps fewer than eight pending messages without a batch", () => {
  const plan = planHistory(messages(15));
  assert.deepEqual(plan.recent.map(({ id }) => id), [8, 9, 10, 11, 12, 13, 14, 15]);
  assert.deepEqual(plan.pending.map(({ id }) => id), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(plan.batch, []);
});

test("planHistory batches pending messages once eight have left the window", () => {
  const sixteen = planHistory(messages(16));
  assert.deepEqual(sixteen.pending.map(({ id }) => id), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(sixteen.batch, sixteen.pending);

  const twenty = planHistory(messages(20));
  assert.deepEqual(twenty.batch.map(({ id }) => id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
});

test("does not summarize below the threshold", async (context) => {
  const { store, conversationId } = seededStore(7);
  context.after(() => store.close());
  const fake = createFakeHistorySummarizer();

  const prepared = await prepareConversationHistory({ store, conversationId, summarizer: fake.summarizer, now });
  assert.equal(fake.calls.length, 0);
  assert.equal(prepared.summary, null);
  assert.equal(prepared.messages.length, 14);
});

test("summarizes the eight oldest messages once they leave the window", async (context) => {
  const { store, conversationId } = seededStore(8);
  context.after(() => store.close());
  const fake = createFakeHistorySummarizer();

  const prepared = await prepareConversationHistory({ store, conversationId, summarizer: fake.summarizer, now });
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0]?.previousSummary, null);
  assert.equal(fake.calls[0]?.targetTokens, 151);
  assert.deepEqual(fake.calls[0]?.messages.map(({ content }) => content), [
    "user 0", "assistant 0", "user 1", "assistant 1",
    "user 2", "assistant 2", "user 3", "assistant 3",
  ]);
  assert.ok(prepared.summary?.startsWith("user: user 0"));
  assert.deepEqual(prepared.messages.map(({ content }) => content), [
    "user 4", "assistant 4", "user 5", "assistant 5",
    "user 6", "assistant 6", "user 7", "assistant 7",
  ]);

  const stored = store.getSummary(conversationId);
  assert.equal(stored?.summary, prepared.summary);
  assert.equal(stored?.coveredUntilMessageId, 8);
  assert.equal(stored?.coveredMessageCount, 8);
});

test("redacts secrets before and after summarization", async (context) => {
  const { store, conversationId } = seededStore(8, (index, role) => `${role} ${index} api_key=abc123`);
  context.after(() => store.close());
  const fake = createFakeHistorySummarizer({ output: () => "Pendente: rotacionar token: xyz789" });

  await prepareConversationHistory({ store, conversationId, summarizer: fake.summarizer, now });
  const sent = fake.calls[0]?.messages.map(({ content }) => content).join("\n") ?? "";
  assert.doesNotMatch(sent, /abc123/);
  assert.match(sent, /api_key=\[REDACTED\]/);
  const stored = store.getSummary(conversationId)?.summary ?? "";
  assert.doesNotMatch(stored, /xyz789/);
  assert.match(stored, /REDACTED/);
});

test("summarizes only when a new batch of eight leaves the window", async (context) => {
  const store = new SqliteConversationStore(":memory:");
  context.after(() => store.close());
  const conversationId = store.create().id;
  const fake = createFakeHistorySummarizer({
    output: (input) => [
      input.previousSummary,
      ...input.messages.map(({ content }) => content.replace("Decisão do turno ", "D")),
    ].filter(Boolean).join("; "),
  });

  const summarizedOnTurns: number[] = [];
  for (let turn = 1; turn <= 20; turn += 1) {
    const callsBefore = fake.calls.length;
    await prepareConversationHistory({ store, conversationId, summarizer: fake.summarizer, now });
    if (fake.calls.length > callsBefore) summarizedOnTurns.push(turn);
    store.append(conversationId, [
      { role: "user", content: `Decisão do turno ${turn}` },
      { role: "assistant", content: `Registrado turno ${turn}` },
    ]);
  }

  assert.deepEqual(summarizedOnTurns, [9, 13, 17]);
  assert.ok(fake.calls[1]?.previousSummary?.startsWith("D1; Registrado turno 1"));
  assert.deepEqual(fake.calls[1]?.messages.map(({ content }) => content), [
    "Decisão do turno 5", "Registrado turno 5", "Decisão do turno 6", "Registrado turno 6",
    "Decisão do turno 7", "Registrado turno 7", "Decisão do turno 8", "Registrado turno 8",
  ]);
  const finalSummary = store.getSummary(conversationId);
  assert.ok(finalSummary?.summary.startsWith("D1;"), "facts from the first batch survive later merges");
  assert.equal(finalSummary?.coveredMessageCount, 24);
});

test("reuses a persisted summary after reopening the store", async () => {
  const directory = mkdtempSync(join(tmpdir(), "opspilot-history-"));
  const path = join(directory, "conversations.db");
  try {
    const first = new SqliteConversationStore(path);
    const conversationId = first.create().id;
    for (let index = 0; index < 8; index += 1) {
      first.append(conversationId, [
        { role: "user", content: `user ${index}` },
        { role: "assistant", content: `assistant ${index}` },
      ]);
    }
    const summarized = await prepareConversationHistory({
      store: first,
      conversationId,
      summarizer: createFakeHistorySummarizer().summarizer,
      now,
    });
    first.close();

    const reopened = new SqliteConversationStore(path);
    try {
      const fresh = createFakeHistorySummarizer();
      const prepared = await prepareConversationHistory({ store: reopened, conversationId, summarizer: fresh.summarizer, now });
      assert.equal(fresh.calls.length, 0);
      assert.equal(prepared.summary, summarized.summary);
      assert.equal(prepared.messages.length, 8);
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("concurrent turns never replace a summary with lesser or equal coverage", async (context) => {
  const { store, conversationId } = seededStore(8);
  context.after(() => store.close());
  const releases: Array<() => void> = [];
  let call = 0;
  const summarizer = async () => {
    call += 1;
    const label = `Resumo ${call}`;
    await new Promise<void>((resolve) => releases.push(resolve));
    return label;
  };

  const first = prepareConversationHistory({ store, conversationId, summarizer, now });
  const second = prepareConversationHistory({ store, conversationId, summarizer, now });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(releases.length, 2);
  releases[0]?.();
  const firstResult = await first;
  releases[1]?.();
  const secondResult = await second;

  const stored = store.getSummary(conversationId);
  assert.equal(stored?.summary, "Resumo 1");
  assert.equal(stored?.coveredUntilMessageId, 8);
  assert.equal(firstResult.summary, "Resumo 1");
  assert.equal(secondResult.summary, "Resumo 1");
  assert.equal(secondResult.messages.length, 8);
});

test("emits a summarize event when the summary is refreshed", async (context) => {
  const { store, conversationId } = seededStore(8);
  context.after(() => store.close());
  const fake = createFakeHistorySummarizer({ output: () => "Decisão: escalar pagamentos. Pendente: postmortem." });

  const prepared = await prepareConversationHistory({ store, conversationId, summarizer: fake.summarizer, now });
  assert.deepEqual(prepared.event, {
    type: "summarize",
    status: "ok",
    messages: 8,
    estimatedTokens: estimateTokens("Decisão: escalar pagamentos. Pendente: postmortem."),
    content: `Summarized 8 older messages into ~${estimateTokens("Decisão: escalar pagamentos. Pendente: postmortem.")} tokens.`,
  });
});

test("emits no summarize event below the threshold", async (context) => {
  const { store, conversationId } = seededStore(7);
  context.after(() => store.close());
  const prepared = await prepareConversationHistory({
    store,
    conversationId,
    summarizer: createFakeHistorySummarizer().summarizer,
    now,
  });
  assert.equal(prepared.event, null);
});

test("keeps the previous summary and reports a failed event when the summarizer fails", async (context) => {
  const { store, conversationId } = seededStore(12);
  context.after(() => store.close());
  store.saveSummary({
    conversationId,
    summary: "Resumo anterior",
    coveredUntilMessageId: 2,
    coveredMessageCount: 2,
    estimatedTokens: 4,
    updatedAt: "2026-10-19T11:00:00.000Z",
  });
  const logs = captureLogs(context);
  const fake = createFakeHistorySummarizer({ error: new Error("model unavailable api_key=abc123") });

  const prepared = await prepareConversationHistory({ store, conversationId, summarizer: fake.summarizer, now });
  assert.equal(prepared.event?.type, "summarize");
  assert.equal(prepared.event?.status, "failed");
  assert.equal(prepared.event?.estimatedTokens, null);
  assert.equal(prepared.event?.messages, 14);
  assert.match(prepared.event?.content ?? "", /^Summarization failed; previous summary kept/);
  assert.doesNotMatch(prepared.event?.content ?? "", /abc123/);
  assert.equal(prepared.summary, "Resumo anterior");
  assert.equal(prepared.messages.length, 22);
  assert.equal(store.getSummary(conversationId)?.summary, "Resumo anterior");
  const failures = logs.named("summarization_failed");
  assert.equal(failures.length, 1);
  assert.deepEqual({ node: failures[0]?.node, conversationId: failures[0]?.conversationId }, { node: "context", conversationId });
  assert.doesNotMatch(logs.lines.join(""), /abc123/);
});

test("rejects oversized or blank summaries as failed summarization", async (context) => {
  for (const output of ["x".repeat(1300), "   "]) {
    const { store, conversationId } = seededStore(8);
    const logs = captureLogs(context);
    const prepared = await prepareConversationHistory({
      store,
      conversationId,
      summarizer: createFakeHistorySummarizer({ output: () => output }).summarizer,
      now,
    });
    assert.equal(prepared.event?.status, "failed");
    assert.equal(store.getSummary(conversationId), undefined);
    assert.equal(prepared.messages.length, 16);
    assert.ok(logs.named("summarization_failed").length >= 1);
    store.close();
  }
});
