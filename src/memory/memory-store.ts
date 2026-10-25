import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  memoryFactSchema,
  memoryIdSchema,
  memoryRecallResultSchema,
  memorySchema,
  memoryUserIdSchema,
  type Memory,
  type MemoryRecallResult,
} from "../domain/domain.ts";
import { MemoryValidationError } from "../domain/errors.ts";
import { embed, type EmbeddingFunction } from "./embeddings.ts";
import {
  compareRecallResults,
  decodeEmbedding,
  dotProduct,
  encodeEmbedding,
} from "./vector.ts";

const MAX_RECALL_RESULTS = 3;
const MIN_RECALL_SCORE = 0.3;
const DEDUPLICATION_SCORE = 0.92;

export function isDuplicateSimilarity(score: number): boolean {
  return score > DEDUPLICATION_SCORE;
}

const schemaSql = `
  CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    fact TEXT NOT NULL CHECK (length(trim(fact)) > 0),
    embedding BLOB NOT NULL CHECK (length(embedding) = 1536),
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS memories_user_id_created_at_id
    ON memories(user_id, created_at, id);
`;

export interface MemoryStore {
  remember(userId: string, fact: string): Promise<{ memory: Memory; inserted: boolean }>;
  recall(userId: string, query: string, k?: number): Promise<MemoryRecallResult[]>;
  forget(userId: string, memoryId: string): boolean;
}

export interface SqliteMemoryStoreOptions {
  embed?: EmbeddingFunction;
  now?: () => Date;
  createId?: () => string;
}

function parseInput<T>(schema: z.ZodType<T>, value: unknown, label: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new MemoryValidationError(`${label} is invalid: ${result.error.message}`, {
      cause: result.error,
    });
  }
  return result.data;
}

function memoryFromRow(row: Record<string, unknown>): Memory {
  return parseInput(memorySchema, {
    id: row.id,
    userId: row.user_id,
    fact: row.fact,
    embedding: decodeEmbedding(row.embedding),
    createdAt: row.created_at,
  }, "Stored memory");
}

export class SqliteMemoryStore implements MemoryStore {
  readonly _db: DatabaseSync;
  private readonly embed: EmbeddingFunction;
  private readonly now: () => Date;
  private readonly createId: () => string;

  constructor(
    path = process.env.OPSPILOT_DB ?? "./data/opspilot.db",
    options: SqliteMemoryStoreOptions = {},
  ) {
    if (path !== ":memory:") {
      mkdirSync(dirname(resolve(path)), { recursive: true });
    }
    this._db = new DatabaseSync(path);
    this.embed = options.embed ?? embed;
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? randomUUID;
    try {
      this._db.exec(schemaSql);
    } catch (error) {
      this._db.close();
      throw error;
    }
  }

  private all(userId: string): Memory[] {
    return this._db.prepare(`
      SELECT id, user_id, fact, embedding, created_at
      FROM memories
      WHERE user_id = ?
      ORDER BY created_at, id
    `).all(userId).map(memoryFromRow);
  }

  async remember(userId: string, fact: string): Promise<{ memory: Memory; inserted: boolean }> {
    const validatedUserId = parseInput(memoryUserIdSchema, userId, "User ID");
    const validatedFact = parseInput(memoryFactSchema, fact, "Memory fact");
    const vector = await this.embed(validatedFact);

    this._db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.all(validatedUserId);
      let bestMatch: Memory | undefined;
      let bestScore = Number.NEGATIVE_INFINITY;
      for (const candidate of existing) {
        const score = dotProduct(vector, candidate.embedding);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = candidate;
        }
      }
      if (bestMatch && isDuplicateSimilarity(bestScore)) {
        this._db.exec("COMMIT");
        return { memory: bestMatch, inserted: false };
      }

      const memory = parseInput(memorySchema, {
        id: this.createId(),
        userId: validatedUserId,
        fact: validatedFact,
        embedding: vector,
        createdAt: this.now().toISOString(),
      }, "New memory");
      this._db.prepare(`
        INSERT INTO memories (id, user_id, fact, embedding, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        memory.id,
        memory.userId,
        memory.fact,
        encodeEmbedding(memory.embedding),
        memory.createdAt,
      );
      this._db.exec("COMMIT");
      return { memory, inserted: true };
    } catch (error) {
      try {
        this._db.exec("ROLLBACK");
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], "Memory transaction and rollback both failed.");
      }
      throw error;
    }
  }

  async recall(userId: string, query: string, k = MAX_RECALL_RESULTS): Promise<MemoryRecallResult[]> {
    const validatedUserId = parseInput(memoryUserIdSchema, userId, "User ID");
    const validatedQuery = parseInput(memoryFactSchema, query, "Memory query");
    if (!Number.isSafeInteger(k) || k < 0) {
      throw new MemoryValidationError("Recall limit must be a non-negative safe integer.");
    }
    const limit = Math.min(k, MAX_RECALL_RESULTS);
    const vector = await this.embed(validatedQuery);
    return this.all(validatedUserId)
      .map((memory) => memoryRecallResultSchema.parse({
        memory,
        score: dotProduct(vector, memory.embedding),
      }))
      .filter(({ score }) => score >= MIN_RECALL_SCORE)
      .sort(compareRecallResults)
      .slice(0, limit);
  }

  forget(userId: string, memoryId: string): boolean {
    const validatedUserId = parseInput(memoryUserIdSchema, userId, "User ID");
    const validatedMemoryId = parseInput(memoryIdSchema, memoryId, "Memory ID");
    const result = this._db.prepare(
      "DELETE FROM memories WHERE user_id = ? AND id = ?",
    ).run(validatedUserId, validatedMemoryId);
    return result.changes === 1;
  }

  close(): void {
    this._db.close();
  }
}
