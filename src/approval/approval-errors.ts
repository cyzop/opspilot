import { OpsPilotError } from "../domain/errors.ts";
import type { Route } from "../graph/routes.ts";
import type { TraceEvent } from "../trace/trace.ts";

export interface ApprovalProposal {
  readonly tool: "resolve_incident";
  readonly args: { id: string };
  readonly target: string;
  readonly description: string;
}

/**
 * Control flow, not a failure: a gated tool asked for a human decision. Strategies rethrow it
 * (never as a tool error or strategy fallback); `/chat` turns it into HTTP 202.
 */
export class ApprovalRequiredError extends OpsPilotError {
  /** Trace produced before the pause; filled in as the error travels up. */
  trace: TraceEvent[] = [];
  /** Strategy that was running (set by the production graph). */
  route: Route | null = null;
  /** History messages sent with the paused turn (set by the production graph). */
  historyMessages = 0;
  /** Model calls and prompt tokens spent before the pause (set by the strategy). */
  metrics: { llmCalls: number; latencyMs: number; promptTokens: number | null } | null = null;

  constructor(readonly proposal: ApprovalProposal) {
    super(`Approval required: ${proposal.description}`);
  }
}

export class UnknownApprovalError extends OpsPilotError {}
export class ApprovalNotPendingError extends OpsPilotError {}

export function isApprovalRequired(error: unknown): error is ApprovalRequiredError {
  return error instanceof ApprovalRequiredError;
}
