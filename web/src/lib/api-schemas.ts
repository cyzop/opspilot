// Zod contracts for every API response the war room reads (constitution II).
import { z } from "zod";

const node = z.string().min(1).optional();
const text = z.string();

export const knownTraceSchemas = {
  thought: z.object({ type: z.literal("thought"), content: text, node }),
  action: z.object({
    type: z.literal("action"),
    content: text,
    tool: z.string().min(1),
    args: z.record(z.string(), z.unknown()),
    node,
  }),
  observation: z.object({ type: z.literal("observation"), content: text, node }),
  plan: z.object({ type: z.literal("plan"), content: text, node }),
  critique: z.object({ type: z.literal("critique"), content: text, node }),
  answer: z.object({ type: z.literal("answer"), content: text, node }),
  summarize: z.object({
    type: z.literal("summarize"),
    content: text,
    status: z.string(),
    messages: z.number().int().nonnegative(),
    estimatedTokens: z.number().int().nonnegative().nullable(),
    node,
  }),
  route: z.object({
    type: z.literal("route"),
    content: text,
    route: z.string().min(1),
    reason: z.string(),
    source: z.string().min(1),
    node,
  }),
  fallback: z.object({
    type: z.literal("fallback"),
    content: text,
    primaryModel: z.string().min(1),
    reserveModel: z.string().min(1),
    reason: z.string(),
    node,
  }),
  approval: z.object({
    type: z.literal("approval"),
    content: text,
    approvalId: z.string().min(1),
    decision: z.enum(["pending", "approved", "denied"]),
    tool: z.string().min(1),
    target: z.string().min(1),
    node,
  }),
} as const;

export type KnownTraceType = keyof typeof knownTraceSchemas;
const knownTypes = Object.keys(knownTraceSchemas);
export const isKnownTraceType = (type: string): type is KnownTraceType => knownTypes.includes(type);

const knownTraceEventSchema = z.discriminatedUnion("type", [
  knownTraceSchemas.thought, knownTraceSchemas.action, knownTraceSchemas.observation,
  knownTraceSchemas.plan, knownTraceSchemas.critique, knownTraceSchemas.answer,
  knownTraceSchemas.summarize, knownTraceSchemas.route, knownTraceSchemas.fallback,
  knownTraceSchemas.approval,
]);

/** Kinds this page does not know yet pass through and render as a generic step (FR-008). */
const unknownTraceEventSchema = z.looseObject({
  type: z.string().min(1).refine((type) => !isKnownTraceType(type)),
});

export const traceEventSchema = z.union([knownTraceEventSchema, unknownTraceEventSchema]);
export type KnownTraceEvent = z.infer<typeof knownTraceEventSchema>;
export type TraceEvent = z.infer<typeof traceEventSchema>;

export const metricsSchema = z.looseObject({
  llmCalls: z.number().int().nonnegative(),
  latencyMs: z.number().nonnegative(),
  promptTokens: z.number().int().nonnegative().nullable(),
  historyMessages: z.number().int().nonnegative(),
  modelUsed: z.string().min(1),
});
export type Metrics = z.infer<typeof metricsSchema>;

export const chatAnswerSchema = z.looseObject({
  answer: z.string(),
  trace: z.array(traceEventSchema),
  conversationId: z.string().min(1),
  requestId: z.string().min(1),
  metrics: metricsSchema,
});
export type ChatAnswer = z.infer<typeof chatAnswerSchema>;

export const approvalSchema = z.looseObject({
  id: z.string().min(1),
  requestId: z.string().min(1),
  conversationId: z.string().min(1),
  tool: z.string().min(1),
  args: z.record(z.string(), z.unknown()),
  target: z.string().min(1),
  description: z.string().min(1),
  status: z.enum(["pending", "approved", "denied", "expired"]),
  createdAt: z.string().min(1),
  expiresAt: z.string().min(1),
  decidedAt: z.string().nullable(),
});
export type Approval = z.infer<typeof approvalSchema>;

export const pendingApprovalSchema = z.looseObject({
  status: z.literal("pending_approval"),
  requestId: z.string().min(1),
  conversationId: z.string().min(1),
  approval: approvalSchema,
  trace: z.array(traceEventSchema),
  metrics: metricsSchema,
});
export type PendingApproval = z.infer<typeof pendingApprovalSchema>;

export const decisionResponseSchema = z.looseObject({
  approval: approvalSchema,
  answer: z.string(),
  trace: z.array(traceEventSchema),
  conversationId: z.string().min(1),
  requestId: z.string().min(1),
  metrics: metricsSchema,
});
export type DecisionResponse = z.infer<typeof decisionResponseSchema>;

export const approvalLookupSchema = z.looseObject({ approval: approvalSchema, requestId: z.string().min(1) });

export const errorBodySchema = z.looseObject({
  error: z.string(),
  requestId: z.string().optional(),
  approval: approvalSchema.optional(),
});
