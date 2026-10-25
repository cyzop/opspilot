import { z } from "zod";

const safeValueSchema: z.ZodType<unknown> = z.unknown();

export const graphNodeSchema = z.enum(["context", "router", "react", "plan-and-execute", "reflection", "response"]);
export type GraphNode = z.infer<typeof graphNodeSchema>;

const node = graphNodeSchema.optional();

export const traceEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("thought"), content: z.string(), node }).strict(),
  z.object({
    type: z.literal("action"),
    content: z.string(),
    tool: z.string().min(1),
    args: z.record(z.string(), safeValueSchema),
    node,
  }).strict(),
  z.object({ type: z.literal("observation"), content: z.string(), node }).strict(),
  z.object({ type: z.literal("plan"), content: z.string(), node }).strict(),
  z.object({ type: z.literal("critique"), content: z.string(), node }).strict(),
  z.object({ type: z.literal("answer"), content: z.string(), node }).strict(),
  z.object({
    type: z.literal("summarize"),
    content: z.string(),
    status: z.enum(["ok", "failed"]),
    messages: z.number().int().nonnegative(),
    estimatedTokens: z.number().int().nonnegative().nullable(),
    node,
  }).strict(),
  z.object({
    type: z.literal("route"),
    content: z.string(),
    route: z.enum(["react", "plan-and-execute", "reflection"]),
    reason: z.string().trim().min(1).max(300),
    source: z.enum(["router", "override", "fallback"]),
    node,
  }).strict(),
  z.object({
    type: z.literal("fallback"),
    content: z.string(),
    primaryModel: z.string().min(1),
    reserveModel: z.string().min(1),
    reason: z.string().trim().min(1).max(300),
    node,
  }).strict(),
  z.object({
    type: z.literal("approval"),
    content: z.string(),
    approvalId: z.uuid(),
    decision: z.enum(["pending", "approved", "denied"]),
    tool: z.literal("resolve_incident"),
    target: z.string().min(1),
    node,
  }).strict(),
]);

export type TraceEvent = z.infer<typeof traceEventSchema>;

export const strategyResultSchema = z.object({
  answer: z.string(),
  trace: z.array(traceEventSchema),
  metrics: z.object({
    llmCalls: z.number().int().nonnegative(),
    latencyMs: z.number().finite().nonnegative(),
    promptTokens: z.number().int().nonnegative().nullable().optional(),
  }).strict(),
}).strict();

export type StrategyResult = z.infer<typeof strategyResultSchema>;

const SECRET_KEY_PATTERN = /api.?key|token|secret|password|authorization|credential/i;
const SECRET_JSON_PATTERN = /(["']?(?:api[_ -]?key|token|secret|password|authorization|credential)["']?\s*:\s*)("[^"]*"|'[^']*'|[^,\s;}]+)/gi;
const SECRET_TEXT_PATTERN = /(?<!["'])\b(api[_ -]?key|token|secret|password|authorization|credential)\b\s*[:=]\s*(?!\[REDACTED\])("[^"]*"|'[^']*'|[^\s,;}\]]+)/gi;

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  if (typeof value === "string") {
    return sanitizeTraceText(value);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : sanitizeValue(child),
      ]),
    );
  }
  return value;
}

export function sanitizeTraceText(text: string): string {
  return text
    .replace(SECRET_JSON_PATTERN, '$1"[REDACTED]"')
    .replace(SECRET_TEXT_PATTERN, "$1=[REDACTED]");
}

export function sanitizeTraceEvent(event: TraceEvent): TraceEvent {
  const content = sanitizeTraceText(event.content);
  if (event.type === "action") {
    return traceEventSchema.parse({ ...event, content, args: sanitizeValue(event.args) });
  }
  if (event.type === "route" || event.type === "fallback") {
    return traceEventSchema.parse({ ...event, content, reason: sanitizeTraceText(event.reason) });
  }
  return traceEventSchema.parse({ ...event, content });
}

export function formatTrace(events: readonly TraceEvent[]): string {
  return events
    .map((rawEvent, index) => {
      const event = sanitizeTraceEvent(rawEvent);
      const details = event.type === "action"
        ? ` [tool=${event.tool} args=${JSON.stringify(event.args)}]`
        : "";
      return `${index + 1}. ${event.type}: ${event.content}${details}`;
    })
    .join("\n");
}

export function validateStrategyResult(result: StrategyResult): StrategyResult {
  return strategyResultSchema.parse({
    ...result,
    answer: sanitizeTraceText(result.answer),
    trace: result.trace.map(sanitizeTraceEvent),
  });
}
