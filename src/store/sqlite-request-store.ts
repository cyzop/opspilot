import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DomainValidationError } from "../domain/errors.ts";
import { traceEventSchema, type TraceEvent } from "../trace/trace.ts";
import {
  requestIdSchema,
  requestRecordSchema,
  type RequestRecord,
  type RequestStore,
  type StoredRequest,
} from "./request-store.ts";

const schemaSql = `
  CREATE TABLE IF NOT EXISTS requests (
    id               TEXT PRIMARY KEY NOT NULL,
    started_at       TEXT NOT NULL,
    duration_ms      INTEGER NOT NULL CHECK (duration_ms >= 0),
    status           INTEGER NOT NULL CHECK (status BETWEEN 100 AND 599),
    error_category   TEXT CHECK (error_category IN
                       ('invalid_request','unknown_conversation','unknown_strategy',
                        'model_unavailable','timeout','internal')),
    conversation_id  TEXT,
    user_id          TEXT,
    requested_route  TEXT CHECK (requested_route IN ('react','plan-and-execute','reflection')),
    route            TEXT CHECK (route IN ('react','plan-and-execute','reflection')),
    llm_calls        INTEGER CHECK (llm_calls >= 0),
    latency_ms       REAL CHECK (latency_ms >= 0),
    prompt_tokens    INTEGER CHECK (prompt_tokens >= 0),
    history_messages INTEGER CHECK (history_messages >= 0),
    model_used       TEXT
  );

  CREATE INDEX IF NOT EXISTS requests_started_at ON requests(started_at);

  CREATE TABLE IF NOT EXISTS trace_events (
    request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    seq        INTEGER NOT NULL CHECK (seq >= 0),
    type       TEXT NOT NULL,
    node       TEXT,
    payload    TEXT NOT NULL,
    PRIMARY KEY (request_id, seq)
  );
`;

function recordFromRow(row: Record<string, unknown>): RequestRecord {
  return requestRecordSchema.parse({
    id: row.id,
    startedAt: row.started_at,
    durationMs: row.duration_ms,
    status: row.status,
    errorCategory: row.error_category,
    conversationId: row.conversation_id,
    userId: row.user_id,
    requestedRoute: row.requested_route,
    route: row.route,
    metrics: row.llm_calls === null
      ? null
      : {
        llmCalls: row.llm_calls,
        latencyMs: row.latency_ms,
        promptTokens: row.prompt_tokens,
        historyMessages: row.history_messages,
        modelUsed: row.model_used,
      },
  });
}

export class SqliteRequestStore implements RequestStore {
  readonly _db: DatabaseSync;

  constructor(path = process.env.OPSPILOT_DB ?? "./data/opspilot.db") {
    if (path !== ":memory:") {
      mkdirSync(dirname(resolve(path)), { recursive: true });
    }
    this._db = new DatabaseSync(path);
    try {
      this._db.exec("PRAGMA foreign_keys = ON");
      // Other stores open their own connections to the same file.
      this._db.exec("PRAGMA busy_timeout = 2000");
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

  record(record: RequestRecord, trace: readonly TraceEvent[]): void {
    const valid = requestRecordSchema.parse(record);
    const events = trace.map((event) => traceEventSchema.parse(event));
    const metrics = valid.metrics;
    this._db.exec("BEGIN");
    try {
      this._db.prepare(`
        INSERT INTO requests (
          id, started_at, duration_ms, status, error_category, conversation_id, user_id,
          requested_route, route, llm_calls, latency_ms, prompt_tokens, history_messages, model_used
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        valid.id,
        valid.startedAt,
        valid.durationMs,
        valid.status,
        valid.errorCategory,
        valid.conversationId,
        valid.userId,
        valid.requestedRoute,
        valid.route,
        metrics?.llmCalls ?? null,
        metrics?.latencyMs ?? null,
        metrics?.promptTokens ?? null,
        metrics?.historyMessages ?? null,
        metrics?.modelUsed ?? null,
      );
      const insertEvent = this._db.prepare(
        "INSERT INTO trace_events (request_id, seq, type, node, payload) VALUES (?, ?, ?, ?, ?)",
      );
      events.forEach((event, seq) => {
        insertEvent.run(valid.id, seq, event.type, event.node ?? null, JSON.stringify(event));
      });
      this._db.exec("COMMIT");
    } catch (error) {
      this._db.exec("ROLLBACK");
      throw error;
    }
  }

  get(id: string): StoredRequest | undefined {
    const parsedId = requestIdSchema.safeParse(id);
    if (!parsedId.success) throw new DomainValidationError("Invalid request id");
    const row = this._db.prepare("SELECT * FROM requests WHERE id = ?").get(parsedId.data);
    if (!row) return undefined;
    const events = this._db.prepare(
      "SELECT payload FROM trace_events WHERE request_id = ? ORDER BY seq",
    ).all(parsedId.data);
    return {
      record: recordFromRow(row),
      trace: events.map((event) => traceEventSchema.parse(JSON.parse(String(event.payload)))),
    };
  }

  listSince(from: Date): RequestRecord[] {
    // started_at is always toISOString() (UTC, fixed width), so text comparison is chronological.
    return this._db.prepare(
      "SELECT * FROM requests WHERE started_at >= ? ORDER BY started_at, id",
    ).all(from.toISOString()).map(recordFromRow);
  }

  close(): void {
    this._db.close();
  }
}
