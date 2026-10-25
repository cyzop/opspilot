import { z } from "zod";
import { routeSchema } from "../graph/routes.ts";
import { errorCategorySchema } from "../store/request-store.ts";
import { graphNodeSchema } from "../trace/trace.ts";
import { currentRequestId } from "./request-context.ts";

export const logLevelSchema = z.enum(["info", "warn", "error"]);
export type LogLevel = z.infer<typeof logLevelSchema>;

export const logEventNameSchema = z.enum([
  "request_started",
  "trace_event",
  "request_finished",
  "persistence_failed",
  "router_fallback",
  "strategy_fallback",
  "model_fallback",
  "summarization_failed",
  "learning_reflection_failed",
]);
export type LogEventName = z.infer<typeof logEventNameSchema>;

// The only fields a log line may carry: identifiers, counts and categories. Never content.
const fieldSchemas = {
  requestId: z.uuid(),
  node: graphNodeSchema,
  type: z.string().min(1).max(64),
  seq: z.number().int().nonnegative(),
  route: routeSchema,
  status: z.number().int().min(100).max(599),
  durationMs: z.number().int().nonnegative(),
  errorCategory: errorCategorySchema.or(z.literal("persistence")),
  traceEvents: z.number().int().nonnegative(),
  llmCalls: z.number().int().nonnegative(),
  promptTokens: z.number().int().nonnegative().nullable(),
  modelUsed: z.string().min(1).max(200),
  primaryModel: z.string().min(1).max(200),
  reserveModel: z.string().min(1).max(200),
  conversationId: z.string().min(1).max(200),
} as const;

export type LogFields = { [K in keyof typeof fieldSchemas]?: z.infer<(typeof fieldSchemas)[K]> };

export const logLineSchema = z.object({
  ts: z.iso.datetime(),
  level: logLevelSchema,
  event: logEventNameSchema,
  ...Object.fromEntries(Object.entries(fieldSchemas).map(([key, schema]) => [key, schema.optional()])),
}).strict();
export type LogLine = { ts: string; level: LogLevel; event: LogEventName } & LogFields;

export function formatLogLine(line: LogLine): string {
  return `${JSON.stringify(line)}\n`;
}

/** Keeps only known fields with valid values (pure). */
export function pickLogFields(fields: Record<string, unknown>): LogFields {
  const picked: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(fieldSchemas)) {
    if (!(key in fields)) continue;
    const parsed = schema.safeParse(fields[key]);
    if (parsed.success) picked[key] = parsed.data;
  }
  return picked as LogFields;
}

type LogWriter = (line: string) => void;

// stderr: stdout carries the MCP stdio protocol and CLI output.
const defaultWriter: LogWriter = (line) => {
  process.stderr.write(line);
};
let writer: LogWriter = defaultWriter;

/** Replaces the writer (tests); returns a function that restores the previous one. */
export function setLogWriter(next: LogWriter): () => void {
  const previous = writer;
  writer = next;
  return () => {
    writer = previous;
  };
}

/** Writes one metadata-only JSON line. Never throws: logging must not break a request. */
export function logEvent(level: LogLevel, event: LogEventName, fields: LogFields = {}): void {
  try {
    const requestId = currentRequestId();
    const line: LogLine = {
      ts: new Date().toISOString(),
      level,
      event,
      ...pickLogFields({ ...(requestId ? { requestId } : {}), ...fields }),
    };
    writer(formatLogLine(line));
  } catch {
    // Swallow: observability failures are not request failures.
  }
}
