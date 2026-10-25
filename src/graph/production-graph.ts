import { isApprovalRequired } from "../approval/approval-errors.ts";
import { END, START, StateGraph, StateSchema } from "@langchain/langgraph";
import { z } from "zod";
import type { StrategyRegistry } from "../agentes/index.ts";
import { buildContext, type BuiltContext, type ContextBudget } from "../context/context-builder.ts";
import { prepareConversationHistory, type HistorySummarizer } from "../context/conversation-history.ts";
import { createUsageRecorder, estimateContextBreakdown, sumPromptTokens } from "../context/tokens.ts";
import { memoryRecallResultSchema } from "../domain/domain.ts";
import { collectModelFallbacks, type ModelFallbackReport } from "../llm/model-events.ts";
import { logEvent } from "../obs/logger.ts";
import type { MemoryStore } from "../memory/memory-store.ts";
import type { ConversationStore } from "../store/conversation-store.ts";
import {
  sanitizeTraceEvent,
  sanitizeTraceText,
  strategyResultSchema,
  traceEventSchema,
  type GraphNode,
  type StrategyResult,
  type TraceEvent,
} from "../trace/trace.ts";
import { decideRoute, routeSchema, type Route, type Router, type RoutingResult } from "./router.ts";

export interface ProductionGraphDependencies {
  readonly registry: StrategyRegistry;
  readonly conversationStore: ConversationStore;
  readonly memoryStore?: MemoryStore;
  readonly summarizer: HistorySummarizer;
  readonly router: Router;
  readonly contextBudget: ContextBudget;
  /** Primary model id, reported as metrics.modelUsed when no call switched to the reserve. */
  readonly primaryModel: string;
}

export interface ProductionGraphInput {
  readonly message: string;
  readonly conversationId?: string;
  readonly userId?: string;
  readonly requestedRoute?: Route;
}

export interface ProductionGraphOutput {
  readonly answer: string;
  readonly trace: TraceEvent[];
  readonly historyMessages: number;
  readonly built: BuiltContext;
  readonly metrics: StrategyResult["metrics"] & { readonly modelUsed: string };
}

const GraphState = new StateSchema({
  message: z.string(),
  conversationId: z.string().optional(),
  userId: z.string().optional(),
  requestedRoute: routeSchema.optional(),
  historyMessages: z.number().int().nonnegative().default(0),
  built: z.custom<BuiltContext>().optional(),
  decision: z.custom<RoutingResult>().optional(),
  routerPromptTokens: z.number().int().nonnegative().nullable().default(null),
  result: z.custom<StrategyResult>().optional(),
  trace: z.array(traceEventSchema).default(() => []),
  output: z.custom<ProductionGraphOutput>().optional(),
});

type State = typeof GraphState.State;

const STRATEGY_NODES = {
  react: "react",
  "plan-and-execute": "plan-and-execute",
  reflection: "reflection",
} as const satisfies Record<Route, GraphNode>;

export function tagTrace(events: readonly TraceEvent[], node: GraphNode): TraceEvent[] {
  return events.map((event) => sanitizeTraceEvent({ ...event, node }));
}

/** One fallback trace event per model call that switched to the reserve. */
export function fallbackEvents(reports: readonly ModelFallbackReport[], node: GraphNode): TraceEvent[] {
  return tagTrace(reports.map(({ primaryModel, reserveModel, reason }) => ({
    type: "fallback" as const,
    primaryModel,
    reserveModel,
    reason,
    content: `Model fallback ${primaryModel} → ${reserveModel}: ${reason}`,
  })), node);
}

/** The reserve model if any call in the turn used it, otherwise the primary. */
export function resolveModelUsed(trace: readonly TraceEvent[], primaryModel: string): string {
  for (const event of trace) {
    if (event.type === "fallback") return event.reserveModel;
  }
  return primaryModel;
}

function requireState<T>(value: T | undefined, name: string): T {
  if (value === undefined) throw new Error(`Production graph state is missing ${name}.`);
  return value;
}

export function createProductionGraph(dependencies: ProductionGraphDependencies) {
  const { registry, conversationStore, memoryStore, summarizer, router, contextBudget, primaryModel } = dependencies;

  async function contextNode(state: State): Promise<Partial<State>> {
    const { value: history, fallbacks } = await collectModelFallbacks(async () => state.conversationId
      ? prepareConversationHistory({ store: conversationStore, conversationId: state.conversationId, summarizer })
      : { summary: null, messages: [], event: null });
    let memories: { fact: string; score: number }[] = [];
    if (state.userId) {
      if (!memoryStore) throw new Error("Semantic memory store is not configured.");
      memories = memoryRecallResultSchema.array()
        .parse(await memoryStore.recall(state.userId, state.message))
        .map(({ memory, score }) => ({ fact: memory.fact, score }));
    }
    const built = buildContext({
      message: state.message,
      history: history.messages,
      summary: history.summary,
      memories,
      budget: contextBudget,
    });
    return {
      built,
      historyMessages: history.messages.length,
      trace: [
        ...state.trace,
        ...fallbackEvents(fallbacks, "context"),
        ...tagTrace(history.event ? [history.event] : [], "context"),
      ],
    };
  }

  async function routerNode(state: State): Promise<Partial<State>> {
    const built = requireState(state.built, "built context");
    const usage = createUsageRecorder();
    const { value: decision, fallbacks } = await collectModelFallbacks(() => decideRoute({
      router,
      input: built.prompt,
      callbacks: [usage.handler],
      ...(state.requestedRoute ? { requestedRoute: state.requestedRoute } : {}),
    }));
    const routeEvent: TraceEvent = {
      type: "route",
      node: "router",
      route: decision.route,
      reason: decision.reason,
      source: decision.source,
      content: `Route ${decision.route} (${decision.source}): ${decision.reason}`,
    };
    return {
      decision,
      routerPromptTokens: usage.promptTokens(),
      trace: [...state.trace, ...fallbackEvents(fallbacks, "router"), ...tagTrace([routeEvent], "router")],
    };
  }

  // Runs a strategy and returns its trace prefixed by the model fallbacks it caused.
  // `fallbacks` keeps the reports when the strategy throws, so a failed attempt is still visible.
  async function runStrategy(
    route: Route,
    prompt: string,
    fallbacks: ModelFallbackReport[] = [],
  ): Promise<{ result: StrategyResult; trace: TraceEvent[] }> {
    const strategy = route === "reflection"
      ? registry.resolve("react", true, 2)
      : registry.resolve(route);
    const { value } = await collectModelFallbacks(async () => strategyResultSchema.parse(await strategy.run(prompt)), fallbacks);
    const node = STRATEGY_NODES[route];
    return { result: value, trace: [...fallbackEvents(fallbacks, node), ...tagTrace(value.trace, node)] };
  }

  function strategyNode(route: Route) {
    return async (state: State): Promise<Partial<State>> => {
      const built = requireState(state.built, "built context");
      const failedFallbacks: ModelFallbackReport[] = [];
      try {
        const { result, trace } = await runStrategy(route, built.prompt, failedFallbacks);
        return { result, trace: [...state.trace, ...trace] };
      } catch (error) {
        // A paused tool is not a strategy failure: no fallback, keep everything seen so far.
        if (isApprovalRequired(error)) {
          const node = STRATEGY_NODES[route];
          error.trace = [...state.trace, ...fallbackEvents(failedFallbacks, node), ...tagTrace(error.trace, node)];
          error.route = route;
          error.historyMessages = state.historyMessages;
          // Same accounting as responseNode: the routing model call counts too.
          if (error.metrics && state.decision?.modelCalled) {
            error.metrics = {
              ...error.metrics,
              llmCalls: error.metrics.llmCalls + 1,
              promptTokens: sumPromptTokens([error.metrics.promptTokens, state.routerPromptTokens]),
            };
          }
          throw error;
        }
        // ReAct is the fallback itself; its failures propagate as before.
        if (route === "react") throw error;
        const details = error instanceof Error ? error.message : String(error);
        const reason = `Strategy ${route} failed: ${sanitizeTraceText(details)}`.slice(0, 300);
        logEvent("warn", "strategy_fallback", { node: STRATEGY_NODES[route], route: "react" });
        const fallbackEvent: TraceEvent = {
          type: "route",
          route: "react",
          reason,
          source: "fallback",
          content: `Route react (fallback): ${reason}`,
        };
        const { result, trace } = await runStrategy("react", built.prompt);
        return {
          result,
          trace: [
            ...state.trace,
            ...fallbackEvents(failedFallbacks, STRATEGY_NODES[route]),
            ...tagTrace([fallbackEvent], STRATEGY_NODES[route]),
            ...trace,
          ],
        };
      }
    };
  }

  async function responseNode(state: State): Promise<Partial<State>> {
    const result = requireState(state.result, "strategy result");
    const decision = requireState(state.decision, "route decision");
    const built = requireState(state.built, "built context");
    const strategyTokens = result.metrics.promptTokens ?? null;
    const metrics = {
      ...result.metrics,
      llmCalls: result.metrics.llmCalls + (decision.modelCalled ? 1 : 0),
      promptTokens: decision.modelCalled
        ? sumPromptTokens([strategyTokens, state.routerPromptTokens])
        : strategyTokens,
      modelUsed: resolveModelUsed(state.trace, primaryModel),
    };
    return {
      output: {
        answer: result.answer,
        trace: state.trace,
        historyMessages: state.historyMessages,
        built,
        metrics,
      },
    };
  }

  const compiled = new StateGraph(GraphState)
    .addNode("context", contextNode)
    .addNode("router", routerNode)
    .addNode("react", strategyNode("react"))
    .addNode("plan-and-execute", strategyNode("plan-and-execute"))
    .addNode("reflection", strategyNode("reflection"))
    .addNode("response", responseNode)
    .addEdge(START, "context")
    .addEdge("context", "router")
    .addConditionalEdges(
      "router",
      (state: State) => STRATEGY_NODES[requireState(state.decision, "route decision").route],
      ["react", "plan-and-execute", "reflection"],
    )
    .addEdge("react", "response")
    .addEdge("plan-and-execute", "response")
    .addEdge("reflection", "response")
    .addEdge("response", END)
    .compile();

  return {
    /**
     * Streams full state after each node so `onTrace` always holds the latest committed trace;
     * when a node throws, the caller still has the events of the nodes that finished.
     */
    async run(
      input: ProductionGraphInput,
      options: { onTrace?: (trace: TraceEvent[]) => void } = {},
    ): Promise<ProductionGraphOutput> {
      const stream = await compiled.stream({
        message: input.message,
        ...(input.conversationId ? { conversationId: input.conversationId } : {}),
        ...(input.userId ? { userId: input.userId } : {}),
        ...(input.requestedRoute ? { requestedRoute: input.requestedRoute } : {}),
      }, { streamMode: "values" });
      let output: ProductionGraphOutput | undefined;
      for await (const state of stream) {
        options.onTrace?.(state.trace);
        output = state.output ?? output;
      }
      return requireState(output, "output");
    },
    breakdown(output: ProductionGraphOutput) {
      return estimateContextBreakdown(output.built.sections);
    },
  };
}
