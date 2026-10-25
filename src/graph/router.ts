import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { z } from "zod";
import { SYSTEM_PROMPT } from "../context/context-builder.ts";
import type { UsageCallback } from "../context/tokens.ts";
import { UnknownStrategyError } from "../domain/errors.ts";
import { createModel } from "../llm/model.ts";
import { sanitizeTraceText } from "../trace/trace.ts";
import { logEvent } from "../obs/logger.ts";

import { ROUTES, routeSchema, type Route } from "./routes.ts";
export { ROUTES, routeSchema, type Route };
export const routeSourceSchema = z.enum(["router", "override", "fallback"]);

export const routeDecisionSchema = z.object({
  route: routeSchema,
  reason: z.string().trim().min(1).max(300).describe("uma frase justificando a escolha"),
}).strict();

export type RouteSource = z.infer<typeof routeSourceSchema>;
export type RouteDecision = z.infer<typeof routeDecisionSchema>;

export type Router = (input: string, callbacks: readonly UsageCallback[]) => Promise<unknown>;

export interface RoutingResult extends RouteDecision {
  readonly source: RouteSource;
  readonly modelCalled: boolean;
}

const MAX_REASON = 300;

export const ROUTER_PROMPT = `${SYSTEM_PROMPT}

Sua tarefa agora é apenas escolher a estratégia de raciocínio para a mensagem atual do contexto abaixo.
Escolha exatamente uma rota da tabela e justifique em uma frase.

| rota | quando usar |
|------|-------------|
| react | pergunta direta, resolvida com 1 a 3 consultas (status, listar alertas ou incidentes, consultar runbook) |
| plan-and-execute | tarefa operacional com várias ações em sequência (triar vários alertas, abrir ou resolver vários incidentes) |
| reflection | resposta de julgamento ou alto impacto que se beneficia de verificação (recomendação, causa raiz, decisão) |

Na dúvida entre react e outra rota, prefira react.`;

export function createLlmRouter(model?: BaseChatModel): Router {
  let resolved = model;
  return async (input, callbacks) => {
    resolved ??= createModel();
    return resolved.withStructuredOutput(routeDecisionSchema).invoke(
      [new SystemMessage(ROUTER_PROMPT), new HumanMessage(input)],
      { callbacks: [...callbacks] },
    );
  };
}

function failureReason(error: unknown): string {
  const details = error instanceof z.ZodError
    ? error.issues.map(({ path, message }) => `${path.join(".") || "output"}: ${message}`).join("; ")
    : error instanceof Error ? error.message : String(error);
  return `Router failed: ${sanitizeTraceText(details)}`.slice(0, MAX_REASON);
}

export async function decideRoute(options: {
  router: Router;
  input: string;
  callbacks: readonly UsageCallback[];
  requestedRoute?: Route;
}): Promise<RoutingResult> {
  if (options.requestedRoute) {
    return {
      route: options.requestedRoute,
      reason: "Strategy requested by the caller.",
      source: "override",
      modelCalled: false,
    };
  }
  try {
    const decision = routeDecisionSchema.parse(await options.router(options.input, options.callbacks));
    return { ...decision, reason: sanitizeTraceText(decision.reason), source: "router", modelCalled: true };
  } catch (error) {
    const reason = failureReason(error);
    // The reason stays in the trace; the log line carries metadata only.
    logEvent("warn", "router_fallback", { node: "router", route: "react" });
    return { route: "react", reason, source: "fallback", modelCalled: true };
  }
}

// Maps the optional request strategy (and the legacy reflection forms) to a route override.
export function routeFromRequest(request: { strategy?: string; reflect?: boolean }): Route | undefined {
  const strategy = request.strategy?.trim();
  if (strategy === undefined || strategy === "") {
    return request.reflect ? "reflection" : undefined;
  }
  const base = strategy.startsWith("reflect:") ? strategy.slice("reflect:".length) : strategy;
  const legacyReflection = strategy.startsWith("reflect:") || request.reflect === true;
  if (base === "reflection") return "reflection";
  if (base === "react" || base === "plan-and-execute") {
    return legacyReflection ? "reflection" : base;
  }
  throw new UnknownStrategyError(`Unknown strategy: ${strategy}`);
}
