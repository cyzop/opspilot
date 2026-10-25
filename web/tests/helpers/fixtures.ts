// Shared test data and a scripted fake `fetch`.

export function answerBody(overrides: Record<string, unknown> = {}) {
  return {
    answer: "Há 2 alertas ativos.",
    trace: [
      { type: "route", content: "Route react", route: "react", reason: "consulta simples", source: "router", node: "router" },
      { type: "action", content: "Requested tool list_alerts", tool: "list_alerts", args: { status: "firing" }, node: "react" },
      { type: "observation", content: "Tool result: [2 alerts]", node: "react" },
      { type: "answer", content: "Há 2 alertas ativos.", node: "react" },
    ],
    conversationId: "conv-1",
    requestId: "req-1",
    metrics: { llmCalls: 2, latencyMs: 812, promptTokens: 950, historyMessages: 0, modelUsed: "openrouter/free", contextBudget: {} },
    ...overrides,
  };
}

export function approvalBody(overrides: Record<string, unknown> = {}) {
  return {
    id: "appr-1",
    requestId: "req-2",
    conversationId: "conv-1",
    tool: "resolve_incident",
    args: { id: "incident-001" },
    target: "incident-001",
    description: "Resolver o incidente incident-001",
    status: "pending",
    createdAt: "2026-10-24T13:05:00.000Z",
    expiresAt: "2026-10-24T13:20:00.000Z",
    decidedAt: null,
    ...overrides,
  };
}

export function pendingBody(overrides: Record<string, unknown> = {}) {
  return {
    status: "pending_approval",
    requestId: "req-2",
    conversationId: "conv-1",
    approval: approvalBody(),
    trace: [
      { type: "action", content: "Requested tool resolve_incident", tool: "resolve_incident", args: { id: "incident-001" }, node: "react" },
      { type: "approval", content: "Aguardando aprovação: Resolver o incidente incident-001", approvalId: "appr-1", decision: "pending", tool: "resolve_incident", target: "incident-001", node: "react" },
    ],
    metrics: { llmCalls: 1, latencyMs: 500, promptTokens: 400, historyMessages: 0, modelUsed: "openrouter/free" },
    ...overrides,
  };
}

export function decisionBody(decision: "approved" | "denied") {
  const answer = decision === "approved"
    ? "Incidente incident-001 resolvido após aprovação do operador."
    : "Resolução do incidente incident-001 negada pelo operador; nada foi alterado.";
  return {
    approval: approvalBody({ status: decision, decidedAt: "2026-10-24T13:06:00.000Z" }),
    answer,
    trace: [
      { type: "approval", content: `Decisão: ${decision}`, approvalId: "appr-1", decision, tool: "resolve_incident", target: "incident-001", node: "response" },
      { type: "answer", content: answer, node: "response" },
    ],
    conversationId: "conv-1",
    requestId: "req-3",
    metrics: { llmCalls: 0, latencyMs: 3, promptTokens: null, historyMessages: 2, modelUsed: "openrouter/free" },
  };
}

export interface ScriptedResponse {
  status: number;
  body?: unknown;
  raw?: string;
  headers?: Record<string, string>;
  /** Resolve only when `release()` is called (to observe loading states). */
  hold?: boolean;
}

export function fakeFetch(script: ScriptedResponse[]) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const releases: Array<() => void> = [];
  let index = 0;
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const step = script[Math.min(index, script.length - 1)];
    index += 1;
    if (!step) throw new TypeError("Failed to fetch");
    if (step.status === 0) throw new TypeError("Failed to fetch");
    if (step.hold) await new Promise<void>((resolve) => releases.push(resolve));
    const payload = step.raw ?? JSON.stringify(step.body ?? null);
    return new Response(payload, { status: step.status, headers: step.headers ?? {} });
  }) as typeof globalThis.fetch;
  return {
    fetch,
    calls,
    release: () => releases.splice(0).forEach((resolve) => resolve()),
  };
}
