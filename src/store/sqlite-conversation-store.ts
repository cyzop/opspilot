import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  conversationIdSchema,
  conversationMessageSchema,
  conversationSchema,
  conversationSummarySchema,
  newConversationMessageSchema,
  type Conversation,
  type ConversationMessage,
  type ConversationSummary,
  type NewConversationMessage,
} from "../domain/domain.ts";
import { UnknownConversationError } from "../domain/errors.ts";
import type { ConversationExchange, ConversationStore } from "./conversation-store.ts";

const schemaSql = `
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL CHECK (length(trim(content)) > 0),
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS messages_conversation_id_id
    ON messages(conversation_id, id);

  CREATE TABLE IF NOT EXISTS conversation_summaries (
    conversation_id TEXT PRIMARY KEY NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    summary TEXT NOT NULL CHECK (length(trim(summary)) > 0),
    covered_until_message_id INTEGER NOT NULL,
    covered_message_count INTEGER NOT NULL,
    estimated_tokens INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  );
`;

function conversationFromRow(row: Record<string, unknown>): Conversation {
  return conversationSchema.parse({ id: row.id, createdAt: row.created_at });
}

function messageFromRow(row: Record<string, unknown>): ConversationMessage {
  return conversationMessageSchema.parse({
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
  });
}

function summaryFromRow(row: Record<string, unknown>): ConversationSummary {
  return conversationSummarySchema.parse({
    conversationId: row.conversation_id,
    summary: row.summary,
    coveredUntilMessageId: row.covered_until_message_id,
    coveredMessageCount: row.covered_message_count,
    estimatedTokens: row.estimated_tokens,
    updatedAt: row.updated_at,
  });
}

export class SqliteConversationStore implements ConversationStore {
  readonly _db: DatabaseSync;
  private readonly now: () => Date;
  private readonly createId: () => string;

  constructor(
    path = process.env.OPSPILOT_DB ?? "./data/opspilot.db",
    options: { now?: () => Date; createId?: () => string } = {},
  ) {
    if (path !== ":memory:") {
      mkdirSync(dirname(resolve(path)), { recursive: true });
    }
    this._db = new DatabaseSync(path);
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;

    try {
      this._db.exec("PRAGMA foreign_keys = ON");
      const foreignKeysEnabled = this._db.prepare("PRAGMA foreign_keys").get()?.foreign_keys;
      if (foreignKeysEnabled !== 1) {
        throw new Error("SQLite foreign-key enforcement could not be enabled.");
      }
      this._db.exec(schemaSql);
    } catch (error) {
      this._db.close();
      throw error;
    }
  }

  create(): Conversation {
    const conversation = conversationSchema.parse({
      id: conversationIdSchema.parse(this.createId()),
      createdAt: this.now().toISOString(),
    });
    this._db.prepare(
      "INSERT INTO conversations (id, created_at) VALUES (?, ?)",
    ).run(conversation.id, conversation.createdAt);
    return conversation;
  }

  get(conversationId: string): Conversation | undefined {
    const id = conversationIdSchema.parse(conversationId);
    const row = this._db.prepare(
      "SELECT id, created_at FROM conversations WHERE id = ?",
    ).get(id);
    return row ? conversationFromRow(row) : undefined;
  }

  append(conversationId: string, exchange: ConversationExchange): ConversationMessage[] {
    const id = conversationIdSchema.parse(conversationId);
    const userMessage = newConversationMessageSchema.parse(exchange[0]);
    const assistantMessage = newConversationMessageSchema.parse(exchange[1]);
    if (userMessage.role !== "user" || assistantMessage.role !== "assistant") {
      throw new Error("Conversation exchanges must contain a user message followed by an assistant message.");
    }

    this._db.exec("BEGIN IMMEDIATE");
    try {
      if (!this.get(id)) {
        throw new UnknownConversationError(`Unknown conversation: ${id}`);
      }
      const insert = this._db.prepare(`
        INSERT INTO messages (conversation_id, role, content, created_at)
        VALUES (?, ?, ?, ?)
      `);
      const createdAt = this.now().toISOString();
      const records = [userMessage, assistantMessage].map((message) => {
        const result = insert.run(id, message.role, message.content, createdAt);
        return conversationMessageSchema.parse({
          id: Number(result.lastInsertRowid),
          conversationId: id,
          role: message.role,
          content: message.content,
          createdAt,
        });
      });
      this._db.exec("COMMIT");
      return records;
    } catch (error) {
      this._db.exec("ROLLBACK");
      throw error;
    }
  }

  lastMessages(conversationId: string, limit: number): ConversationMessage[] {
    const id = conversationIdSchema.parse(conversationId);
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new RangeError("Conversation message limit must be a positive integer.");
    }
    if (!this.get(id)) {
      throw new UnknownConversationError(`Unknown conversation: ${id}`);
    }
    return this._db.prepare(`
      SELECT id, conversation_id, role, content, created_at
      FROM messages
      WHERE conversation_id = ?
      ORDER BY id DESC
      LIMIT ?
    `).all(id, limit).reverse().map(messageFromRow);
  }

  messagesAfter(conversationId: string, afterMessageId: number): ConversationMessage[] {
    const id = conversationIdSchema.parse(conversationId);
    if (!Number.isSafeInteger(afterMessageId) || afterMessageId < 0) {
      throw new RangeError("Message cursor must be a non-negative integer.");
    }
    if (!this.get(id)) {
      throw new UnknownConversationError(`Unknown conversation: ${id}`);
    }
    return this._db.prepare(`
      SELECT id, conversation_id, role, content, created_at
      FROM messages
      WHERE conversation_id = ? AND id > ?
      ORDER BY id ASC
    `).all(id, afterMessageId).map(messageFromRow);
  }

  getSummary(conversationId: string): ConversationSummary | undefined {
    const id = conversationIdSchema.parse(conversationId);
    const row = this._db.prepare(`
      SELECT conversation_id, summary, covered_until_message_id, covered_message_count,
        estimated_tokens, updated_at
      FROM conversation_summaries
      WHERE conversation_id = ?
    `).get(id);
    return row ? summaryFromRow(row) : undefined;
  }

  saveSummary(summary: ConversationSummary): boolean {
    const record = conversationSummarySchema.parse(summary);
    const result = this._db.prepare(`
      INSERT INTO conversation_summaries (
        conversation_id, summary, covered_until_message_id, covered_message_count,
        estimated_tokens, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(conversation_id) DO UPDATE SET
        summary = excluded.summary,
        covered_until_message_id = excluded.covered_until_message_id,
        covered_message_count = excluded.covered_message_count,
        estimated_tokens = excluded.estimated_tokens,
        updated_at = excluded.updated_at
      WHERE excluded.covered_until_message_id > conversation_summaries.covered_until_message_id
    `).run(
      record.conversationId,
      record.summary,
      record.coveredUntilMessageId,
      record.coveredMessageCount,
      record.estimatedTokens,
      record.updatedAt,
    );
    return Number(result.changes) > 0;
  }

  close(): void {
    this._db.close();
  }
}
