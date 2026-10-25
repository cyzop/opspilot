import {
  ModelUnavailableError,
  RequestTimeoutError,
  UnknownConversationError,
  UnknownStrategyError,
} from "../domain/errors.ts";
import type { ErrorCategory } from "../store/request-store.ts";

export interface ChatErrorClassification {
  readonly status: number;
  readonly category: ErrorCategory;
  readonly message: string;
}

function isBodyParseError(error: unknown): boolean {
  return error instanceof Error && (error as { type?: unknown }).type === "entity.parse.failed";
}

/** One table for the HTTP status, the stored error category and the client message. */
export function classifyChatError(error: unknown): ChatErrorClassification {
  if (isBodyParseError(error)) return { status: 400, category: "invalid_request", message: "Invalid JSON body" };
  if (error instanceof UnknownConversationError) return { status: 404, category: "unknown_conversation", message: error.message };
  if (error instanceof UnknownStrategyError) return { status: 422, category: "unknown_strategy", message: error.message };
  if (error instanceof ModelUnavailableError) return { status: 503, category: "model_unavailable", message: error.message };
  if (error instanceof RequestTimeoutError) return { status: 504, category: "timeout", message: error.message };
  return {
    status: 500,
    category: "internal",
    message: error instanceof Error ? error.message : "Internal server error",
  };
}
