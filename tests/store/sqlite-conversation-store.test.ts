import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { UnknownConversationError } from "../../src/domain/errors.ts";
import { SqliteConversationStore } from "../../src/store/sqlite-conversation-store.ts";

test("creates conversations and appends ordered message pairs atomically", (context) => {
  const store = new SqliteConversationStore(":memory:", {
    now: () => new Date("2026-10-12T12:00:00.000Z"),
  });
  context.after(() => store.close());

  const conversation = store.create();
  assert.equal(store.get(conversation.id)?.id, conversation.id);
  assert.deepEqual(store.append(conversation.id, [
    { role: "user", content: "First question" },
    { role: "assistant", content: "First answer" },
  ]).map(({ role, content }) => ({ role, content })), [
    { role: "user", content: "First question" },
    { role: "assistant", content: "First answer" },
  ]);
  assert.deepEqual(store.lastMessages(conversation.id, 2).map(({ id }) => id), [1, 2]);
});

test("returns the most recent messages chronologically and validates the limit", (context) => {
  const store = new SqliteConversationStore(":memory:");
  context.after(() => store.close());
  const conversation = store.create();

  for (let index = 0; index < 8; index += 1) {
    store.append(conversation.id, [
      { role: "user", content: `Question ${index}` },
      { role: "assistant", content: `Answer ${index}` },
    ]);
  }

  assert.deepEqual(
    store.lastMessages(conversation.id, 3).map(({ content }) => content),
    ["Answer 6", "Question 7", "Answer 7"],
  );
  assert.throws(() => store.lastMessages(conversation.id, 0), /positive integer/i);
  assert.throws(() => store.lastMessages(conversation.id, 1.5), /positive integer/i);
});

test("enforces foreign keys and rejects unknown conversations", (context) => {
  const store = new SqliteConversationStore(":memory:");
  context.after(() => store.close());
  assert.equal(store._db.prepare("PRAGMA foreign_keys").get()?.foreign_keys, 1);
  assert.throws(() => store.lastMessages("missing", 12), UnknownConversationError);
  assert.throws(
    () => store.append("missing", [
      { role: "user", content: "Question" },
      { role: "assistant", content: "Answer" },
    ]),
    UnknownConversationError,
  );
  assert.throws(() => store.append("missing", [
    { role: "user", content: "Question" },
    { role: "assistant", content: "" },
  ]), /Too small: expected string to have >=1 characters/);
});

test("rolls back the user message when the assistant insert fails", (context) => {
  const store = new SqliteConversationStore(":memory:");
  context.after(() => store.close());
  const conversation = store.create();
  store._db.exec(`
    CREATE TRIGGER reject_assistant_message
    BEFORE INSERT ON messages
    WHEN NEW.role = 'assistant'
    BEGIN
      SELECT RAISE(ABORT, 'assistant message rejected');
    END;
  `);

  assert.throws(() => store.append(conversation.id, [
    { role: "user", content: "Question" },
    { role: "assistant", content: "Answer" },
  ]), /assistant message rejected/);
  assert.deepEqual(store.lastMessages(conversation.id, 12), []);
});

test("isolates memory databases and persists conversations across reopening", (context) => {
  const firstMemory = new SqliteConversationStore(":memory:");
  const secondMemory = new SqliteConversationStore(":memory:");
  context.after(() => {
    firstMemory.close();
    secondMemory.close();
  });
  const memoryConversation = firstMemory.create();
  assert.equal(secondMemory.get(memoryConversation.id), undefined);

  const directory = mkdtempSync(join(tmpdir(), "opspilot-conversations-"));
  const path = join(directory, "conversations.db");
  try {
    const first = new SqliteConversationStore(path);
    const conversation = first.create();
    first.append(conversation.id, [
      { role: "user", content: "Persistent question" },
      { role: "assistant", content: "Persistent answer" },
    ]);
    first.close();

    const reopened = new SqliteConversationStore(path);
    try {
      assert.deepEqual(
        reopened.lastMessages(conversation.id, 12).map(({ content }) => content),
        ["Persistent question", "Persistent answer"],
      );
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function seedMessages(store: SqliteConversationStore, conversationId: string, pairs: number): void {
  for (let index = 0; index < pairs; index += 1) {
    store.append(conversationId, [
      { role: "user", content: `Question ${index}` },
      { role: "assistant", content: `Answer ${index}` },
    ]);
  }
}

function summaryFor(conversationId: string, coveredUntilMessageId: number, summary = "Resumo") {
  return {
    conversationId,
    summary,
    coveredUntilMessageId,
    coveredMessageCount: coveredUntilMessageId,
    estimatedTokens: Math.ceil(summary.length / 4),
    updatedAt: "2026-10-19T12:00:00.000Z",
  };
}

test("messagesAfter returns messages newer than the cursor in order", (context) => {
  const store = new SqliteConversationStore(":memory:");
  context.after(() => store.close());
  const conversation = store.create();
  seedMessages(store, conversation.id, 3);

  assert.deepEqual(store.messagesAfter(conversation.id, 0).map(({ id }) => id), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(store.messagesAfter(conversation.id, 4).map(({ content }) => content), ["Question 2", "Answer 2"]);
  assert.throws(() => store.messagesAfter(conversation.id, -1), RangeError);
  assert.throws(() => store.messagesAfter(conversation.id, 1.5), RangeError);
  assert.throws(() => store.messagesAfter("missing", 0), UnknownConversationError);
});

test("saveSummary stores a summary and only accepts greater coverage", (context) => {
  const store = new SqliteConversationStore(":memory:");
  context.after(() => store.close());
  const conversation = store.create();
  seedMessages(store, conversation.id, 8);

  assert.equal(store.getSummary(conversation.id), undefined);
  assert.equal(store.saveSummary(summaryFor(conversation.id, 8, "Primeiro resumo")), true);
  assert.deepEqual(store.getSummary(conversation.id), summaryFor(conversation.id, 8, "Primeiro resumo"));

  assert.equal(store.saveSummary(summaryFor(conversation.id, 8, "Mesmo alcance")), false);
  assert.equal(store.saveSummary(summaryFor(conversation.id, 4, "Menor alcance")), false);
  assert.equal(store.getSummary(conversation.id)?.summary, "Primeiro resumo");

  assert.equal(store.saveSummary(summaryFor(conversation.id, 16, "Resumo maior")), true);
  assert.equal(store.getSummary(conversation.id)?.summary, "Resumo maior");
});

test("summaries cascade with their conversation", (context) => {
  const store = new SqliteConversationStore(":memory:");
  context.after(() => store.close());
  const conversation = store.create();
  seedMessages(store, conversation.id, 4);
  store.saveSummary(summaryFor(conversation.id, 8));

  store._db.prepare("DELETE FROM conversations WHERE id = ?").run(conversation.id);
  assert.equal(
    store._db.prepare("SELECT COUNT(*) AS count FROM conversation_summaries").get()?.count,
    0,
  );
});

test("summaries persist across reopening the database", () => {
  const directory = mkdtempSync(join(tmpdir(), "opspilot-summaries-"));
  const path = join(directory, "conversations.db");
  try {
    const first = new SqliteConversationStore(path);
    const conversation = first.create();
    seedMessages(first, conversation.id, 4);
    first.saveSummary(summaryFor(conversation.id, 8, "Resumo persistido"));
    first.close();

    const reopened = new SqliteConversationStore(path);
    try {
      assert.equal(reopened.getSummary(conversation.id)?.summary, "Resumo persistido");
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
