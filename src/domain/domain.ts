import { z } from "zod";

export const severitySchema = z.enum(["critical", "high", "medium", "low"]);
export const alertStatusSchema = z.enum(["firing", "resolved"]);
export const incidentStatusSchema = z.enum(["open", "resolved"]);
export const alertFilterSchema = z.enum(["firing", "resolved", "all"]);
export const incidentFilterSchema = z.enum(["open", "resolved", "all"]);
export const conversationIdSchema = z.string().trim().min(1);
export const conversationRoleSchema = z.enum(["user", "assistant"]);
export const conversationSchema = z.object({
  id: conversationIdSchema,
  createdAt: z.string().datetime(),
}).strict();
export const conversationMessageSchema = z.object({
  id: z.number().int().positive().safe(),
  conversationId: conversationIdSchema,
  role: conversationRoleSchema,
  content: z.string().trim().min(1),
  createdAt: z.string().datetime(),
}).strict();
export const conversationSummarySchema = z.object({
  conversationId: conversationIdSchema,
  summary: z.string().trim().min(1),
  coveredUntilMessageId: z.number().int().positive().safe(),
  coveredMessageCount: z.number().int().positive().safe(),
  estimatedTokens: z.number().int().nonnegative(),
  updatedAt: z.string().datetime(),
}).strict();
export const newConversationMessageSchema = z.object({
  role: conversationRoleSchema,
  content: z.string().trim().min(1),
}).strict();

export const memoryUserIdSchema = z.string().trim().min(1);
export const memoryIdSchema = z.string().trim().min(1);
export const memoryFactSchema = z.string().trim().min(1);
export const memorySchema = z.object({
  id: memoryIdSchema,
  userId: memoryUserIdSchema,
  fact: memoryFactSchema,
  embedding: z.custom<Float32Array>((embedding) =>
    embedding instanceof Float32Array
    && embedding.length === 384
    && Array.from(embedding).every(Number.isFinite),
  ),
  createdAt: z.string().datetime(),
}).strict();
export const learningReflectionSchema = z.object({
  hasLearning: z.boolean(),
  fact: z.string().trim().default(""),
}).strict().superRefine((value, ctx) => {
  const fact = value.fact.trim();
  if (value.hasLearning && fact.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["fact"],
      message: "A learning fact is required when hasLearning is true.",
    });
  }
  if (!value.hasLearning && fact.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["fact"],
      message: "A fact must be empty when hasLearning is false.",
    });
  }
});
export const memoryRecallResultSchema = z.object({
  memory: memorySchema,
  score: z.number().finite(),
}).strict();

const learningSecretPattern = /(password|passphrase|api[_ -]?key|access[_ -]?token|private[_ -]?key|secret(?:[_ -]?key)?|bearer\s+[A-Za-z0-9._~+/-]+=*)/i;
const learningTransientPattern = /\b(?:please|can you|could you|help me|show me|today|right now|for now|temporary|this incident|current incident|incident now|asap|this time|just this once)\b/i;
const learningDurablePattern = /\b(?:prefer|prefers|prefer to|preferably|like|likes|want|wants|need|needs|default|defaults|usually|always|tend to|expect|expects|favourite|favorite|keep|keeps)\b/i;

export function validateLearningFact(fact: string): string | null {
  const cleaned = fact.trim();
  if (!cleaned || cleaned.length < 6) {
    return null;
  }
  if (learningSecretPattern.test(cleaned)) {
    return null;
  }
  if (learningTransientPattern.test(cleaned)) {
    return null;
  }
  if (!learningDurablePattern.test(cleaned)) {
    return null;
  }
  return cleaned;
}

export const serviceSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
}).strict();

export const alertSchema = z.object({
  id: z.string().trim().min(1),
  serviceId: z.string().trim().min(1),
  title: z.string().trim().min(1),
  severity: severitySchema,
  status: alertStatusSchema,
  createdAt: z.string().datetime(),
}).strict();

export const incidentSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  serviceId: z.string().trim().min(1),
  severity: severitySchema,
  status: incidentStatusSchema,
  createdAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable(),
  summary: z.string().trim().min(1).nullable().default(null),
}).strict();

export const runbookSchema = z.object({
  service: z.string().trim().min(1),
  name: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  steps: z.array(z.string().trim().min(1)).min(1),
}).strict();

export const openIncidentInputSchema = z.object({
  title: z.string().trim().min(1).describe("Título curto que identifique o problema operacional."),
  service: z.string().trim().min(1).describe("Identificador de um serviço conhecido, como checkout ou payments."),
  severity: severitySchema.describe("Severidade do incidente: critical, high, medium ou low."),
}).strict();

export const resolveIncidentInputSchema = z.object({
  id: z.string().trim().min(1).describe("Identificador do incidente aberto que será resolvido."),
}).strict();

export const listIncidentsInputSchema = z.object({
  status: incidentFilterSchema
    .describe("Filtro de incidentes: open, resolved ou all; o padrão é open.")
    .default("open"),
}).strict();

export const getRunbookInputSchema = z.object({
  service: z.string().trim().min(1)
    .describe("Identificador do serviço cujo runbook deve ser consultado, como checkout, payments ou auth."),
}).strict();

export type ServiceRecord = z.infer<typeof serviceSchema>;
export type AlertRecord = z.infer<typeof alertSchema>;
export type IncidentRecord = z.infer<typeof incidentSchema>;
export type AlertFilter = z.infer<typeof alertFilterSchema>;
export type IncidentFilter = z.infer<typeof incidentFilterSchema>;
export type Conversation = z.infer<typeof conversationSchema>;
export type ConversationMessage = z.infer<typeof conversationMessageSchema>;
export type ConversationRole = z.infer<typeof conversationRoleSchema>;
export type ConversationSummary = z.infer<typeof conversationSummarySchema>;
export type NewConversationMessage = z.infer<typeof newConversationMessageSchema>;
export type LearningReflectionResult = z.infer<typeof learningReflectionSchema>;
export type Memory = z.infer<typeof memorySchema>;
export type MemoryRecallResult = z.infer<typeof memoryRecallResultSchema>;
export type RunbookRecord = z.infer<typeof runbookSchema>;
export type OpenIncidentInput = z.infer<typeof openIncidentInputSchema>;
