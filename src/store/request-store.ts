import { z } from "zod";
import { routeSchema } from "../graph/routes.ts";
import type { TraceEvent } from "../trace/trace.ts";

export const errorCategorySchema = z.enum([
  "invalid_request",
  "unknown_conversation",
  "unknown_strategy",
  "model_unavailable",
  "timeout",
  "internal",
]);
export type ErrorCategory = z.infer<typeof errorCategorySchema>;

export const requestIdSchema = z.uuid();

export const requestMetricsSchema = z.object({
  llmCalls: z.number().int().nonnegative(),
  latencyMs: z.number().finite().nonnegative(),
  promptTokens: z.number().int().nonnegative().nullable(),
  historyMessages: z.number().int().nonnegative(),
  modelUsed: z.string().min(1),
}).strict();
export type RequestMetrics = z.infer<typeof requestMetricsSchema>;

export const requestRecordSchema = z.object({
  id: requestIdSchema,
  startedAt: z.iso.datetime(),
  durationMs: z.number().int().nonnegative(),
  status: z.number().int().min(100).max(599),
  errorCategory: errorCategorySchema.nullable(),
  conversationId: z.string().min(1).nullable(),
  userId: z.string().min(1).nullable(),
  /** Route override sent by the client (`strategy` / `reflect`). */
  requestedRoute: routeSchema.nullable(),
  /** Strategy that actually produced the answer (last `route` event of the trace). */
  route: routeSchema.nullable(),
  metrics: requestMetricsSchema.nullable(),
}).strict().refine(
  (record) => {
    // 200 answers and 202 pending approvals both completed the turn they started.
    const ok = record.status >= 200 && record.status < 300;
    return ok === (record.errorCategory === null) && ok === (record.metrics !== null);
  },
  { message: "Only 2xx records have metrics and no error category." },
);
export type RequestRecord = z.infer<typeof requestRecordSchema>;

export interface StoredRequest {
  readonly record: RequestRecord;
  readonly trace: TraceEvent[];
}

export interface RequestStore {
  /** Saves the record and its ordered trace in one transaction. */
  record(record: RequestRecord, trace: readonly TraceEvent[]): void;
  get(id: string): StoredRequest | undefined;
  /** Records with `startedAt >= from`, oldest first (no traces). */
  listSince(from: Date): RequestRecord[];
  close(): void;
}

/** The strategy that answered: the last `route` event wins (a fallback overrides the router). */
export function chosenRoute(trace: readonly TraceEvent[]): RequestRecord["route"] {
  for (let index = trace.length - 1; index >= 0; index -= 1) {
    const event = trace[index];
    if (event?.type === "route") return event.route;
  }
  return null;
}

export function buildRequestRecord(input: {
  id: string;
  startedAt: Date;
  finishedAt: Date;
  status: number;
  errorCategory: ErrorCategory | null;
  conversationId: string | null;
  userId: string | null;
  requestedRoute: RequestRecord["requestedRoute"];
  trace: readonly TraceEvent[];
  metrics: RequestMetrics | null;
}): RequestRecord {
  return requestRecordSchema.parse({
    id: input.id,
    startedAt: input.startedAt.toISOString(),
    durationMs: Math.max(0, Math.round(input.finishedAt.getTime() - input.startedAt.getTime())),
    status: input.status,
    errorCategory: input.errorCategory,
    conversationId: input.conversationId,
    userId: input.userId,
    requestedRoute: input.requestedRoute,
    route: chosenRoute(input.trace),
    metrics: input.metrics,
  });
}
