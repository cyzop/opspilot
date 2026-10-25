// Pure chat state: turns, conversation id and notices. Effects (fetch) live in App.tsx.
import type { ApiError } from "./api-client.ts";
import type { Approval, ChatAnswer, DecisionResponse, Metrics, PendingApproval, TraceEvent } from "./api-schemas.ts";

export interface FinalAnswer {
  answer: string;
  trace: TraceEvent[];
  metrics: Metrics;
  requestId: string;
}

export type DecisionState = "idle" | "sending" | "approved" | "denied" | "not_pending";

export type Turn =
  | { id: string; message: string; status: "sending" }
  | ({ id: string; message: string; status: "answered" } & FinalAnswer)
  | {
    id: string;
    message: string;
    status: "awaiting_approval";
    approval: Approval;
    trace: TraceEvent[];
    metrics: Metrics;
    requestId: string;
    decision: DecisionState;
    decisionError?: ApiError;
    final?: FinalAnswer;
  }
  | { id: string; message: string; status: "failed"; error: ApiError };

export interface ChatState {
  conversationId: string | null;
  turns: Turn[];
  notice: string | null;
}

export type ChatAction =
  | { type: "send"; id: string; message: string }
  | { type: "answered"; id: string; body: ChatAnswer }
  | { type: "awaitingApproval"; id: string; body: PendingApproval }
  | { type: "failed"; id: string; error: ApiError }
  | { type: "retry"; id: string }
  | { type: "decisionSent"; id: string }
  | { type: "decided"; id: string; body: DecisionResponse }
  | { type: "decisionRefused"; id: string; approval?: Approval }
  | { type: "decisionFailed"; id: string; error: ApiError }
  | { type: "newConversation" }
  | { type: "apiChanged" };

export const initialChatState: ChatState = { conversationId: null, turns: [], notice: null };

export const LOST_CONVERSATION_NOTICE = "A conversa anterior não existe mais; uma nova foi iniciada.";
export const API_CHANGED_NOTICE = "A URL da API mudou; a próxima mensagem inicia uma nova conversa.";

/** True while a message or an approval decision is in flight. */
export function isBusy(state: ChatState): boolean {
  return state.turns.some((turn) => turn.status === "sending"
    || (turn.status === "awaiting_approval" && turn.decision === "sending"));
}

function update(state: ChatState, id: string, change: (turn: Turn) => Turn | undefined): ChatState {
  let changed = false;
  const turns = state.turns.map((turn) => {
    if (turn.id !== id) return turn;
    const next = change(turn);
    if (!next) return turn;
    changed = true;
    return next;
  });
  return changed ? { ...state, turns } : state;
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case "send": {
      const message = action.message.trim();
      if (!message || isBusy(state)) return state;
      return { ...state, notice: null, turns: [...state.turns, { id: action.id, message, status: "sending" }] };
    }
    case "answered": {
      const next = update(state, action.id, (turn) => turn.status === "sending"
        ? {
          id: turn.id,
          message: turn.message,
          status: "answered",
          answer: action.body.answer,
          trace: action.body.trace,
          metrics: action.body.metrics,
          requestId: action.body.requestId,
        }
        : undefined);
      return next === state ? state : { ...next, conversationId: action.body.conversationId };
    }
    case "awaitingApproval": {
      const next = update(state, action.id, (turn) => turn.status === "sending"
        ? {
          id: turn.id,
          message: turn.message,
          status: "awaiting_approval",
          approval: action.body.approval,
          trace: action.body.trace,
          metrics: action.body.metrics,
          requestId: action.body.requestId,
          decision: action.body.approval.status === "pending" ? "idle" : "not_pending",
        }
        : undefined);
      return next === state ? state : { ...next, conversationId: action.body.conversationId };
    }
    case "failed": {
      const next = update(state, action.id, (turn) => turn.status === "sending"
        ? { id: turn.id, message: turn.message, status: "failed", error: action.error }
        : undefined);
      const lostConversation = action.error.kind === "http" && action.error.status === 404 && state.conversationId !== null;
      return lostConversation && next !== state
        ? { ...next, conversationId: null, notice: LOST_CONVERSATION_NOTICE }
        : next;
    }
    case "retry":
      if (isBusy(state)) return state;
      return update(state, action.id, (turn) => turn.status === "failed"
        ? { id: turn.id, message: turn.message, status: "sending" }
        : undefined);
    case "decisionSent":
      if (isBusy(state)) return state;
      return update(state, action.id, (turn) => {
        if (turn.status !== "awaiting_approval" || turn.decision !== "idle") return undefined;
        const { decisionError: _cleared, ...rest } = turn;
        return { ...rest, decision: "sending" };
      });
    case "decided":
      return update(state, action.id, (turn) => turn.status === "awaiting_approval"
        ? {
          ...turn,
          approval: action.body.approval,
          decision: action.body.approval.status === "approved" ? "approved" : "denied",
          final: {
            answer: action.body.answer,
            trace: action.body.trace,
            metrics: action.body.metrics,
            requestId: action.body.requestId,
          },
        }
        : undefined);
    case "decisionRefused":
      return update(state, action.id, (turn) => turn.status === "awaiting_approval"
        ? { ...turn, decision: "not_pending", ...(action.approval ? { approval: action.approval } : {}) }
        : undefined);
    case "decisionFailed":
      return update(state, action.id, (turn) => turn.status === "awaiting_approval"
        ? { ...turn, decision: "idle", decisionError: action.error }
        : undefined);
    case "newConversation":
      return isBusy(state) ? state : initialChatState;
    case "apiChanged":
      return { ...state, conversationId: null, notice: state.turns.length > 0 ? API_CHANGED_NOTICE : null };
  }
}
