// Typed client for the OpsPilot API. `fetch` is injected so the logic stays testable.
import type { z } from "zod";
import {
  approvalLookupSchema,
  chatAnswerSchema,
  decisionResponseSchema,
  errorBodySchema,
  pendingApprovalSchema,
  type Approval,
  type ChatAnswer,
  type DecisionResponse,
  type PendingApproval,
} from "./api-schemas.ts";

export type ApiErrorKind = "network" | "timeout" | "http" | "invalid_response";

export interface ApiError {
  kind: ApiErrorKind;
  message: string;
  status?: number;
  requestId?: string;
}

export type ChatResult =
  | { ok: true; kind: "answer"; body: ChatAnswer }
  | { ok: true; kind: "approval"; body: PendingApproval }
  | { ok: false; error: ApiError };

export type DecisionResult =
  | { ok: true; kind: "decided"; body: DecisionResponse }
  | { ok: true; kind: "not_pending"; approval?: Approval }
  | { ok: false; error: ApiError };

export type ApprovalLookupResult = { ok: true; approval: Approval } | { ok: false; error: ApiError };
export type ConnectionResult = { ok: true } | { ok: false; message: string };

export interface ApiClient {
  readonly baseUrl: string;
  chat(input: { message: string; conversationId?: string | null }): Promise<ChatResult>;
  decide(approvalId: string, decision: "approve" | "deny"): Promise<DecisionResult>;
  getApproval(approvalId: string): Promise<ApprovalLookupResult>;
  testConnection(): Promise<ConnectionResult>;
}

export interface ApiClientOptions {
  baseUrl: string;
  fetch: typeof globalThis.fetch;
  timeoutMs?: number;
}

export const NETWORK_MESSAGE = "Não foi possível conectar à API (rede ou CORS).";
export const TIMEOUT_MESSAGE = "A API demorou demais para responder.";
export const INVALID_MESSAGE = "A API respondeu em um formato inesperado.";

export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

type ErrorContext = "chat" | "decision" | "other";

/** Plain-language message for an HTTP failure (never the raw API text). */
export function httpErrorMessage(status: number, context: ErrorContext = "other"): string {
  if (status === 400) return context === "chat" ? "A mensagem foi recusada pela API." : "O pedido foi recusado pela API.";
  if (status === 404) return context === "chat" ? "A conversa não existe mais na API." : "O recurso não foi encontrado na API.";
  if (status === 503) return "Nenhum modelo disponível no momento. Tente de novo em instantes.";
  if (status === 504) return TIMEOUT_MESSAGE;
  return `Erro inesperado da API (HTTP ${status}).`;
}

interface Raw {
  status: number;
  body: unknown;
  requestId?: string;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const timeoutMs = options.timeoutMs ?? 190_000;

  async function request(path: string, init: RequestInit = {}): Promise<Raw | { error: ApiError }> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    try {
      const response = await options.fetch(joinUrl(options.baseUrl, path), { ...init, signal: controller.signal });
      const headerId = response.headers.get("X-Request-Id") ?? undefined;
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      return { status: response.status, body, ...(headerId ? { requestId: headerId } : {}) };
    } catch {
      return timedOut
        ? { error: { kind: "timeout", message: TIMEOUT_MESSAGE } }
        : { error: { kind: "network", message: NETWORK_MESSAGE } };
    } finally {
      clearTimeout(timer);
    }
  }

  function httpError(raw: Raw, context: ErrorContext): ApiError {
    const parsed = errorBodySchema.safeParse(raw.body);
    const requestId = (parsed.success ? parsed.data.requestId : undefined) ?? raw.requestId;
    return {
      kind: "http",
      status: raw.status,
      message: httpErrorMessage(raw.status, context),
      ...(requestId ? { requestId } : {}),
    };
  }

  function parse<T>(schema: z.ZodType<T>, raw: Raw): { ok: true; data: T } | { ok: false; error: ApiError } {
    const parsed = schema.safeParse(raw.body);
    if (parsed.success) return { ok: true, data: parsed.data };
    return {
      ok: false,
      error: {
        kind: "invalid_response",
        status: raw.status,
        message: INVALID_MESSAGE,
        ...(raw.requestId ? { requestId: raw.requestId } : {}),
      },
    };
  }

  const post = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  return {
    baseUrl: options.baseUrl,

    async chat({ message, conversationId }) {
      const raw = await request("chat", post({ message, ...(conversationId ? { conversationId } : {}) }));
      if ("error" in raw) return { ok: false, error: raw.error };
      if (raw.status === 200) {
        const parsed = parse(chatAnswerSchema, raw);
        return parsed.ok ? { ok: true, kind: "answer", body: parsed.data } : parsed;
      }
      if (raw.status === 202) {
        const parsed = parse(pendingApprovalSchema, raw);
        return parsed.ok ? { ok: true, kind: "approval", body: parsed.data } : parsed;
      }
      return { ok: false, error: httpError(raw, "chat") };
    },

    async decide(approvalId, decision) {
      const raw = await request(`approvals/${encodeURIComponent(approvalId)}/decision`, post({ decision }));
      if ("error" in raw) return { ok: false, error: raw.error };
      if (raw.status === 200) {
        const parsed = parse(decisionResponseSchema, raw);
        return parsed.ok ? { ok: true, kind: "decided", body: parsed.data } : parsed;
      }
      if (raw.status === 409 || raw.status === 404) {
        const parsed = errorBodySchema.safeParse(raw.body);
        const approval = parsed.success ? parsed.data.approval : undefined;
        return { ok: true, kind: "not_pending", ...(approval ? { approval } : {}) };
      }
      return { ok: false, error: httpError(raw, "decision") };
    },

    async getApproval(approvalId) {
      const raw = await request(`approvals/${encodeURIComponent(approvalId)}`);
      if ("error" in raw) return { ok: false, error: raw.error };
      if (raw.status !== 200) return { ok: false, error: httpError(raw, "other") };
      const parsed = parse(approvalLookupSchema, raw);
      return parsed.ok ? { ok: true, approval: parsed.data.approval } : parsed;
    },

    async testConnection() {
      const raw = await request("stats?since=1m");
      if ("error" in raw) return { ok: false, message: raw.error.message };
      if (raw.status >= 200 && raw.status < 300) return { ok: true };
      return { ok: false, message: `Resposta inesperada da API (HTTP ${raw.status}).` };
    },
  };
}
