import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DomainValidationError } from "../domain/errors.ts";
import {
  APPROVAL_TTL_MS,
  approvalIdSchema,
  approvalSchema,
  newApprovalSchema,
  type ApprovalStore,
  type ClaimResult,
  type NewApproval,
  type StoredApproval,
} from "./approval-store.ts";

const schemaSql = `
  CREATE TABLE IF NOT EXISTS approvals (
    id                  TEXT PRIMARY KEY NOT NULL,
    request_id          TEXT NOT NULL,
    conversation_id     TEXT NOT NULL,
    tool                TEXT NOT NULL CHECK (tool IN ('resolve_incident')),
    args                TEXT NOT NULL,
    target              TEXT NOT NULL,
    description         TEXT NOT NULL,
    route               TEXT CHECK (route IN ('react','plan-and-execute','reflection')),
    model_used          TEXT,
    status              TEXT NOT NULL CHECK (status IN ('pending','approved','denied')),
    created_at          TEXT NOT NULL,
    expires_at          TEXT NOT NULL,
    decided_at          TEXT,
    decision_request_id TEXT
  );
  CREATE INDEX IF NOT EXISTS approvals_status ON approvals(status, expires_at);
`;

function fromRow(row: Record<string, unknown>, now: Date): StoredApproval {
  const stored = String(row.status);
  // expires_at is always toISOString() (UTC, fixed width), so text comparison is chronological.
  const expired = stored === "pending" && String(row.expires_at) <= now.toISOString();
  return {
    approval: approvalSchema.parse({
      id: row.id,
      requestId: row.request_id,
      conversationId: row.conversation_id,
      tool: row.tool,
      args: JSON.parse(String(row.args)),
      target: row.target,
      description: row.description,
      status: expired ? "expired" : stored,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      decidedAt: row.decided_at,
    }),
    route: (row.route ?? null) as StoredApproval["route"],
    modelUsed: row.model_used === null || row.model_used === undefined ? null : String(row.model_used),
  };
}

export class SqliteApprovalStore implements ApprovalStore {
  readonly _db: DatabaseSync;

  constructor(path = process.env.OPSPILOT_DB ?? "./data/opspilot.db") {
    if (path !== ":memory:") mkdirSync(dirname(resolve(path)), { recursive: true });
    this._db = new DatabaseSync(path);
    try {
      this._db.exec("PRAGMA busy_timeout = 2000");
      this._db.exec(schemaSql);
    } catch (error) {
      this._db.close();
      throw error;
    }
  }

  create(input: NewApproval, now: Date): StoredApproval {
    const valid = newApprovalSchema.parse(input);
    this._db.prepare(`
      INSERT INTO approvals (id, request_id, conversation_id, tool, args, target, description,
                             route, model_used, status, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(
      valid.id,
      valid.requestId,
      valid.conversationId,
      valid.tool,
      JSON.stringify(valid.args),
      valid.target,
      valid.description,
      valid.route,
      valid.modelUsed,
      now.toISOString(),
      new Date(now.getTime() + APPROVAL_TTL_MS).toISOString(),
    );
    const created = this.get(valid.id, now);
    if (!created) throw new Error(`Approval ${valid.id} was not stored.`);
    return created;
  }

  get(id: string, now: Date): StoredApproval | undefined {
    const parsed = approvalIdSchema.safeParse(id);
    if (!parsed.success) throw new DomainValidationError("Invalid approval id");
    const row = this._db.prepare("SELECT * FROM approvals WHERE id = ?").get(parsed.data);
    return row ? fromRow(row, now) : undefined;
  }

  claim(id: string, decision: "approved" | "denied", decisionRequestId: string, now: Date): ClaimResult {
    const parsed = approvalIdSchema.safeParse(id);
    if (!parsed.success) throw new DomainValidationError("Invalid approval id");
    const at = now.toISOString();
    const { changes } = this._db.prepare(`
      UPDATE approvals SET status = ?, decided_at = ?, decision_request_id = ?
      WHERE id = ? AND status = 'pending' AND expires_at > ?
    `).run(decision, at, decisionRequestId, parsed.data, at);
    if (Number(changes) === 1) {
      const stored = this.get(parsed.data, now);
      if (stored) return { ok: true, stored };
    }
    return { ok: false, reason: this.get(parsed.data, now) ? "not_pending" : "unknown" };
  }

  close(): void {
    this._db.close();
  }
}
