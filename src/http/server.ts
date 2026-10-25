import express from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createStrategyRegistry, type StrategyRegistry } from "../agentes/index.ts";
import {
  conversationIdSchema,
  memoryFactSchema,
  memorySchema,
  memoryUserIdSchema,
} from "../domain/domain.ts";
import {
  ConfigurationError,
  DomainValidationError,
  MemoryValidationError,
  RequestTimeoutError,
  UnknownConversationError,
  UnknownRequestError,
} from "../domain/errors.ts";
import { strategyResultSchema, traceEventSchema, type TraceEvent } from "../trace/trace.ts";
import {
  buildRequestRecord,
  chosenRoute,
  requestIdSchema,
  requestRecordSchema,
  type ErrorCategory,
  type RequestMetrics,
  type RequestRecord,
  type RequestStore,
} from "../store/request-store.ts";
import { SqliteRequestStore } from "../store/sqlite-request-store.ts";
import { logEvent, type LogLevel } from "../obs/logger.ts";
import { runWithRequestContext } from "../obs/request-context.ts";
import { SqliteConversationStore } from "../store/sqlite-conversation-store.ts";
import type { ConversationStore } from "../store/conversation-store.ts";
import { SqliteMemoryStore, type MemoryStore } from "../memory/memory-store.ts";
import { reflectUserLearning } from "../strategies/reflection.ts";
import { contextBudgetReportSchema, loadContextBudget, type ContextBudget } from "../context/context-builder.ts";
import type { HistorySummarizer } from "../context/conversation-history.ts";
import { createLlmHistorySummarizer } from "../context/llm-history-summarizer.ts";
import { createLlmRouter, routeFromRequest, type Route, type Router } from "../graph/router.ts";
import { contextBreakdownSchema } from "../context/tokens.ts";
import { describeModelFallback, readModelSettings } from "../llm/model.ts";
import { classifyChatError } from "./chat-errors.ts";
import { corsMiddleware, parseCorsOrigins } from "./cors.ts";
import { HTTP_APPROVAL_POLICY, runWithApprovalPolicy } from "../approval/approval-context.ts";
import { isApprovalRequired, type ApprovalRequiredError } from "../approval/approval-errors.ts";
import { approvalSchema, type ApprovalStore } from "../approval/approval-store.ts";
import { SqliteApprovalStore } from "../approval/sqlite-approval-store.ts";
import { awaitingApprovalNote, decisionOutcome, pendingTraceEvent, type Execution } from "../approval/approval-service.ts";
import { OpsService } from "../domain/ops-service.ts";
import type { OpsStore } from "../store/ops-store.ts";
import { SqliteOpsStore } from "../store/sqlite-ops-store.ts";
import { createProductionGraph, resolveModelUsed } from "../graph/production-graph.ts";
import { computeStats, DEFAULT_SINCE, loadModelPrices, parseSince, type ModelPrices } from "../stats/stats.ts";

export const chatRequestSchema = z.object({
  message: z.string().trim().min(1),
  strategy: z.string().trim().optional(),
  reflect: z.boolean().optional().default(false),
  conversationId: conversationIdSchema.optional(),
  userId: memoryUserIdSchema.optional(),
}).strict();

const chatResponseSchema = strategyResultSchema.extend({
  trace: strategyResultSchema.shape.trace.refine(
    (events) => events.every((event) => event.node !== undefined),
    { message: "Every chat trace event must name its graph node." },
  ),
  conversationId: conversationIdSchema,
  requestId: requestIdSchema,
  metrics: strategyResultSchema.shape.metrics.extend({
    historyMessages: z.number().int().nonnegative(),
    promptTokens: z.number().int().nonnegative().nullable(),
    contextBreakdown: contextBreakdownSchema,
    contextBudget: contextBudgetReportSchema,
    modelUsed: z.string().min(1),
  }),
}).strict();

const requestLookupResponseSchema = z.object({
  request: requestRecordSchema,
  trace: z.array(traceEventSchema),
}).strict();

const groupStatsSchema = z.object({
  total: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  promptTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative().nullable(),
  latencyMs: z.object({ p50: z.number().nonnegative().nullable(), p95: z.number().nonnegative().nullable() }).strict(),
}).strict();

const statsResponseSchema = groupStatsSchema.extend({
  since: z.string(),
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  errorRate: z.number().min(0).max(1),
  requestsWithoutTokens: z.number().int().nonnegative(),
  unpricedModels: z.array(z.string()),
  byRoute: z.record(z.string(), groupStatsSchema),
  byModel: z.record(z.string(), groupStatsSchema),
}).strict();

const turnMetricsSchema = z.object({
  llmCalls: z.number().int().nonnegative(),
  latencyMs: z.number().finite().nonnegative(),
  promptTokens: z.number().int().nonnegative().nullable(),
  historyMessages: z.number().int().nonnegative(),
  modelUsed: z.string().min(1),
}).strict();

const pendingApprovalResponseSchema = z.object({
  status: z.literal("pending_approval"),
  requestId: requestIdSchema,
  conversationId: conversationIdSchema,
  approval: approvalSchema,
  trace: z.array(traceEventSchema),
  metrics: turnMetricsSchema,
}).strict();

const decisionRequestSchema = z.object({ decision: z.enum(["approve", "deny"]) }).strict();

const decisionResponseSchema = z.object({
  approval: approvalSchema,
  answer: z.string(),
  trace: z.array(traceEventSchema),
  conversationId: conversationIdSchema,
  requestId: requestIdSchema,
  metrics: turnMetricsSchema,
}).strict();

export const rememberRequestSchema = z.object({
  userId: memoryUserIdSchema,
  fact: memoryFactSchema,
}).strict();

const rememberResponseSchema = memorySchema.omit({ embedding: true }).extend({
  inserted: z.boolean(),
}).strict();

export interface ChatServerOptions {
  registry?: StrategyRegistry;
  conversationStore?: ConversationStore;
  memoryStore?: MemoryStore;
  timeoutMs?: number;
  summarizer?: HistorySummarizer;
  contextBudget?: ContextBudget;
  router?: Router;
  /** Generates request ids (default: random UUID). */
  createRequestId?: () => string;
  /** Stores one record + ordered trace per /chat request (default: SQLite at OPSPILOT_DB). */
  requestStore?: RequestStore;
  /** USD per 1M prompt tokens for GET /stats (default: OPSPILOT_MODEL_PRICES). */
  modelPrices?: ModelPrices;
  /** Origins allowed to call the API from a browser (default: OPSPILOT_CORS_ORIGINS or the war room dev origin). */
  corsOrigins?: readonly string[];
  /** Pending approvals for resolve_incident (default: SQLite at OPSPILOT_DB). */
  approvalStore?: ApprovalStore;
  /** Ops data shared with the strategies; approved resolutions run against it. */
  opsStore?: OpsStore;
  /** Runs an approved resolution (default: OpsService over opsStore). */
  resolveIncident?: (id: string) => unknown;
  /** Clock for GET /stats windows and approval expiry (tests). */
  now?: () => Date;
  /** Primary model id for metrics.modelUsed; defaults to OPENROUTER_MODEL. */
  models?: { primary: string };
  learningReflector?: (input: { userId: string; message: string; memoryStore: MemoryStore; }) => Promise<boolean>;
}

async function withRequestTimeout<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new RequestTimeoutError(`Request timed out after ${Math.round(timeoutMs / 1000)}s`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function createChatServer(options: ChatServerOptions = {}): express.Express {
  const app = express();
  app.use(corsMiddleware(options.corsOrigins ?? parseCorsOrigins(process.env.OPSPILOT_CORS_ORIGINS)));
  const registry = options.registry ?? createStrategyRegistry();
  const conversationStore = options.conversationStore ?? new SqliteConversationStore();
  const memoryStore = options.memoryStore;
  const timeoutMs = options.timeoutMs ?? 180_000;
  const summarizer = options.summarizer ?? createLlmHistorySummarizer();
  const contextBudget = options.contextBudget ?? loadContextBudget();
  const primaryModel = options.models?.primary ?? readModelSettings(process.env, { lenient: true }).primary;
  const graph = createProductionGraph({
    registry,
    conversationStore,
    ...(memoryStore ? { memoryStore } : {}),
    summarizer,
    router: options.router ?? createLlmRouter(),
    contextBudget,
    primaryModel,
  });
  const learningReflector = options.learningReflector ?? (async ({ userId, message, memoryStore }) => {
    return reflectUserLearning({ userId, message, memoryStore });
  });

  const createRequestId = options.createRequestId ?? randomUUID;
  const requestStore = options.requestStore ?? new SqliteRequestStore();
  const modelPrices = options.modelPrices ?? loadModelPrices(process.env);
  const now = options.now ?? (() => new Date());
  const approvalStore = options.approvalStore ?? new SqliteApprovalStore();
  let opsService: OpsService | undefined;
  const resolveIncident = options.resolveIncident ?? ((id: string) => {
    opsService ??= new OpsService(options.opsStore ?? new SqliteOpsStore());
    return opsService.resolveIncident(id);
  });

  interface RequestFacts {
    conversationId: string | null;
    userId: string | null;
    requestedRoute: Route | null;
    trace: TraceEvent[];
  }

  // Saves the record before the response is sent, then logs one line per trace event and a
  // finish line. Storage or logging failures never change the response.
  function recordRequest(
    res: express.Response,
    facts: RequestFacts,
    outcome: { status: number; errorCategory: ErrorCategory | null; metrics: RequestMetrics | null },
  ): RequestRecord | undefined {
    const requestId = String(res.locals.requestId);
    const startedAt = res.locals.startedAt as Date;
    const finishedAt = new Date();
    let record: RequestRecord | undefined;
    try {
      record = buildRequestRecord({ id: requestId, startedAt, finishedAt, ...facts, ...outcome });
      requestStore.record(record, facts.trace);
    } catch {
      logEvent("error", "persistence_failed", { requestId, errorCategory: "persistence" });
    }
    facts.trace.forEach((event, seq) => {
      logEvent("info", "trace_event", { requestId, seq, type: event.type, ...(event.node ? { node: event.node } : {}) });
    });
    const level: LogLevel = outcome.status >= 500 ? "error" : outcome.status >= 400 ? "warn" : "info";
    const route = chosenRoute(facts.trace);
    logEvent(level, "request_finished", {
      requestId,
      status: outcome.status,
      durationMs: Math.max(0, Math.round(finishedAt.getTime() - startedAt.getTime())),
      traceEvents: facts.trace.length,
      ...(outcome.errorCategory ? { errorCategory: outcome.errorCategory } : {}),
      ...(route ? { route } : {}),
      ...(outcome.metrics
        ? {
          llmCalls: outcome.metrics.llmCalls,
          promptTokens: outcome.metrics.promptTokens,
          modelUsed: outcome.metrics.modelUsed,
        }
        : {}),
      ...(facts.conversationId ? { conversationId: facts.conversationId } : {}),
    });
    return record;
  }

  const emptyFacts = (): RequestFacts => ({ conversationId: null, userId: null, requestedRoute: null, trace: [] });

  // Runs before body parsing so every /chat response (even malformed JSON) has an id.
  // A client-sent X-Request-Id is never read.
  app.use(["/chat", "/approvals"], (_req, res, next) => {
    const requestId = requestIdSchema.parse(createRequestId());
    res.locals.requestId = requestId;
    res.locals.startedAt = new Date();
    res.setHeader("X-Request-Id", requestId);
    logEvent("info", "request_started", { requestId });
    next();
  });

  app.use(express.json({ limit: "1mb" }));

  app.post("/chat", (req, res) => runWithRequestContext({ requestId: String(res.locals.requestId) }, async () => {
    const requestId = String(res.locals.requestId);
    const facts = emptyFacts();
    let turn: { message: string; conversationId: string } | undefined;
    try {
      const parsed = chatRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        recordRequest(res, facts, { status: 400, errorCategory: "invalid_request", metrics: null });
        res.status(400).json({
          error: "Invalid request body",
          issues: parsed.error.issues,
          requestId,
        });
        return;
      }

      const { message, strategy, reflect, conversationId, userId } = parsed.data;
      facts.conversationId = conversationId ?? null;
      facts.userId = userId ?? null;
      const existingConversation = conversationId
        ? conversationStore.get(conversationId)
        : undefined;
      if (conversationId && !existingConversation) {
        throw new UnknownConversationError(`Unknown conversation: ${conversationId}`);
      }
      const requestedRoute = routeFromRequest({ ...(strategy ? { strategy } : {}), reflect });
      facts.requestedRoute = requestedRoute ?? null;
      if (userId) requireMemoryStore(memoryStore);
      const conversation = existingConversation ?? conversationStore.create();
      facts.conversationId = conversation.id;
      turn = { message, conversationId: conversation.id };
      const output = await withRequestTimeout(() => runWithApprovalPolicy(HTTP_APPROVAL_POLICY, () => graph.run({
        message,
        ...(conversationId ? { conversationId } : {}),
        ...(userId ? { userId } : {}),
        ...(requestedRoute ? { requestedRoute } : {}),
      }, { onTrace: (trace) => { facts.trace = trace; } })), timeoutMs);
      const response = chatResponseSchema.parse({
        answer: output.answer,
        trace: output.trace,
        conversationId: conversation.id,
        requestId,
        metrics: {
          ...output.metrics,
          historyMessages: output.historyMessages,
          promptTokens: output.metrics.promptTokens ?? null,
          contextBreakdown: graph.breakdown(output),
          contextBudget: output.built.report,
        },
      });
      conversationStore.append(conversation.id, [
        { role: "user", content: message },
        { role: "assistant", content: output.answer },
      ]);
      facts.trace = response.trace;
      recordRequest(res, facts, {
        status: 200,
        errorCategory: null,
        metrics: {
          llmCalls: response.metrics.llmCalls,
          latencyMs: response.metrics.latencyMs,
          promptTokens: response.metrics.promptTokens,
          historyMessages: response.metrics.historyMessages,
          modelUsed: response.metrics.modelUsed,
        },
      });

      if (userId && memoryStore) {
        void learningReflector({ userId, message, memoryStore }).catch(() => {
          logEvent("warn", "learning_reflection_failed", { requestId });
        });
      }

      res.status(200).json(response);
    } catch (error) {
      if (isApprovalRequired(error) && turn) {
        respondPendingApproval(res, facts, turn, error);
        return;
      }
      const { status, category, message } = classifyChatError(error);
      recordRequest(res, facts, { status, errorCategory: category, metrics: null });
      res.status(status).json({ error: message, requestId });
    }
  }));

  // The turn paused before resolve_incident: store the proposal and answer 202.
  function respondPendingApproval(
    res: express.Response,
    facts: RequestFacts,
    turn: { message: string; conversationId: string },
    error: ApprovalRequiredError,
  ): void {
    const requestId = String(res.locals.requestId);
    const trace = error.trace;
    const modelUsed = resolveModelUsed(trace, primaryModel);
    const { approval } = approvalStore.create({
      id: randomUUID(),
      requestId,
      conversationId: turn.conversationId,
      tool: error.proposal.tool,
      args: error.proposal.args,
      target: error.proposal.target,
      description: error.proposal.description,
      route: error.route,
      modelUsed,
    }, now());
    const startedAt = res.locals.startedAt as Date;
    const metrics = {
      llmCalls: error.metrics?.llmCalls ?? 0,
      latencyMs: error.metrics?.latencyMs ?? Math.max(0, Date.now() - startedAt.getTime()),
      promptTokens: error.metrics?.promptTokens ?? null,
      historyMessages: error.historyMessages,
      modelUsed,
    };
    const response = pendingApprovalResponseSchema.parse({
      status: "pending_approval",
      requestId,
      conversationId: turn.conversationId,
      approval,
      trace: [...trace, pendingTraceEvent(approval, error.route ?? "react")],
      metrics,
    });
    conversationStore.append(turn.conversationId, [
      { role: "user", content: turn.message },
      { role: "assistant", content: awaitingApprovalNote(approval) },
    ]);
    facts.trace = response.trace;
    recordRequest(res, facts, { status: 202, errorCategory: null, metrics });
    res.status(202).json(response);
  }

  app.get("/approvals/:id", (req, res) => {
    const requestId = String(res.locals.requestId);
    try {
      const stored = approvalStore.get(req.params.id, now());
      if (!stored) {
        res.status(404).json({ error: "Unknown approval", requestId });
        return;
      }
      res.status(200).json({ approval: approvalSchema.parse(stored.approval), requestId });
    } catch (error) {
      if (error instanceof DomainValidationError) {
        res.status(400).json({ error: "Invalid approval id", requestId });
        return;
      }
      res.status(500).json({ error: "Internal server error", requestId });
    }
  });

  app.post("/approvals/:id/decision", (req, res) => runWithRequestContext({ requestId: String(res.locals.requestId) }, async () => {
    const requestId = String(res.locals.requestId);
    const facts = emptyFacts();
    const refuse = (status: number, body: Record<string, unknown>) => {
      recordRequest(res, facts, { status, errorCategory: status >= 500 ? "internal" : "invalid_request", metrics: null });
      res.status(status).json({ ...body, requestId });
    };
    try {
      let current;
      try {
        current = approvalStore.get(req.params.id, now());
      } catch (error) {
        if (error instanceof DomainValidationError) {
          refuse(400, { error: "Invalid approval id" });
          return;
        }
        throw error;
      }
      const parsed = decisionRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        refuse(400, { error: "Invalid request body", issues: parsed.error.issues });
        return;
      }
      if (!current) {
        refuse(404, { error: "Unknown approval" });
        return;
      }
      facts.conversationId = current.approval.conversationId;
      const decision = parsed.data.decision === "approve" ? "approved" : "denied";
      const claim = approvalStore.claim(req.params.id, decision, requestId, now());
      if (!claim.ok) {
        const latest = approvalStore.get(req.params.id, now());
        if (claim.reason === "unknown" || !latest) refuse(404, { error: "Unknown approval" });
        else refuse(409, { error: "Approval is no longer pending", approval: latest.approval });
        return;
      }

      const { approval, modelUsed } = claim.stored;
      let execution: Execution | undefined;
      if (decision === "approved") {
        try {
          execution = { ok: true, result: await resolveIncident(approval.args.id) };
        } catch (error) {
          execution = { ok: false, message: error instanceof Error ? error.message : String(error) };
        }
      }
      const outcome = decisionOutcome({ approval, decision, ...(execution ? { execution } : {}) });
      conversationStore.append(approval.conversationId, [
        { role: "user", content: `Decisão do operador: ${decision === "approved" ? "aprovar" : "negar"} — ${approval.description}` },
        { role: "assistant", content: outcome.answer },
      ]);
      const startedAt = res.locals.startedAt as Date;
      const metrics = {
        llmCalls: 0,
        latencyMs: Math.max(0, Date.now() - startedAt.getTime()),
        promptTokens: null,
        historyMessages: 0,
        modelUsed: modelUsed ?? primaryModel,
      };
      const response = decisionResponseSchema.parse({
        approval,
        answer: outcome.answer,
        trace: outcome.trace,
        conversationId: approval.conversationId,
        requestId,
        metrics,
      });
      facts.trace = response.trace;
      recordRequest(res, facts, { status: 200, errorCategory: null, metrics });
      res.status(200).json(response);
    } catch (error) {
      const { status, category, message } = classifyChatError(error);
      recordRequest(res, facts, { status, errorCategory: category, metrics: null });
      res.status(status).json({ error: message, requestId });
    }
  }));

  // Body-parser failures (malformed JSON) never reach the handler above.
  app.use(["/chat", "/approvals"], (error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const { status, category, message } = classifyChatError(error);
    recordRequest(res, emptyFacts(), { status, errorCategory: category, metrics: null });
    res.status(status).json({ error: message, requestId: String(res.locals.requestId) });
  });

  app.get("/stats", (req, res) => {
    try {
      const since = typeof req.query.since === "string" ? req.query.since : DEFAULT_SINCE;
      const to = now();
      const from = new Date(to.getTime() - parseSince(since));
      const stats = computeStats(requestStore.listSince(from), modelPrices);
      res.status(200).json(statsResponseSchema.parse({ since, from: from.toISOString(), to: to.toISOString(), ...stats }));
    } catch (error) {
      if (error instanceof DomainValidationError) {
        res.status(400).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: error instanceof Error ? error.message : "Internal server error" });
    }
  });

  app.get("/requests/:id", (req, res) => {
    const id = requestIdSchema.safeParse(req.params.id);
    if (!id.success) {
      res.status(400).json({ error: "Invalid request id" });
      return;
    }
    try {
      const stored = requestStore.get(id.data);
      if (!stored) throw new UnknownRequestError(`Unknown request: ${id.data}`);
      res.status(200).json(requestLookupResponseSchema.parse({ request: stored.record, trace: stored.trace }));
    } catch (error) {
      if (error instanceof UnknownRequestError) {
        res.status(404).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: error instanceof Error ? error.message : "Internal server error" });
    }
  });

  app.post("/memories", async (req, res) => {
    try {
      const parsed = rememberRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          error: "Invalid request body",
          issues: parsed.error.issues,
        });
        return;
      }

      const { userId, fact } = parsed.data;
      const { memory, inserted } = await requireMemoryStore(memoryStore).remember(userId, fact);
      const response = rememberResponseSchema.parse({
        id: memory.id,
        userId: memory.userId,
        fact: memory.fact,
        createdAt: memory.createdAt,
        inserted,
      });
      res.status(inserted ? 201 : 200).json(response);
    } catch (error) {
      if (error instanceof MemoryValidationError) {
        res.status(400).json({ error: error.message });
        return;
      }
      const message = error instanceof Error ? error.message : "Internal server error";
      res.status(500).json({ error: message });
    }
  });

  return app;
}

// Printed once at startup; a missing configuration is reported by the first model call.
function logModelFallbackSetup(): void {
  try {
    console.log(describeModelFallback(readModelSettings(process.env)));
  } catch (error) {
    if (!(error instanceof ConfigurationError)) throw error;
  }
}

function requireMemoryStore(memoryStore: MemoryStore | undefined): MemoryStore {
  if (!memoryStore) {
    throw new Error("Semantic memory store is not configured.");
  }
  return memoryStore;
}

export async function startChatServer(
  port: number = Number(process.env.PORT ?? 3000),
  options: ChatServerOptions = {},
): Promise<ReturnType<express.Express["listen"]>> {
  const ownsConversationStore = !options.conversationStore;
  const conversationStore = options.conversationStore ?? new SqliteConversationStore();
  const ownsMemoryStore = !options.memoryStore;
  const memoryStore = options.memoryStore ?? new SqliteMemoryStore();
  const ownsRequestStore = !options.requestStore;
  const requestStore = options.requestStore ?? new SqliteRequestStore();
  const ownsApprovalStore = !options.approvalStore;
  const approvalStore = options.approvalStore ?? new SqliteApprovalStore();
  logModelFallbackSetup();
  const app = createChatServer({ ...options, conversationStore, memoryStore, requestStore, approvalStore });
  const server = await new Promise<ReturnType<express.Express["listen"]>>((resolve) => {
    const server = app.listen(port, () => resolve(server));
  });
  server.once("close", () => {
    if (ownsConversationStore) conversationStore.close();
    if (ownsMemoryStore && memoryStore instanceof SqliteMemoryStore) memoryStore.close();
    if (ownsRequestStore) requestStore.close();
    if (ownsApprovalStore) approvalStore.close();
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3000);
  void startChatServer(port).then((server) => {
    console.log(`OpsPilot chat server listening on http://localhost:${port}`);
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`OpsPilot chat server failed: ${message}\n`);
    process.exitCode = 1;
  });
}
