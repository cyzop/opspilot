import { ConfigurationError, ModelUnavailableError, StrategyLimitError } from "../domain/errors.ts";

/**
 * - `abort`: never retry, never switch to the reserve (budget, config, cancellation, already final).
 * - `permanent`: the request itself is wrong; do not retry, but the reserve may still answer.
 * - `transient`: retry, then switch to the reserve.
 */
export type ModelErrorClass = "abort" | "permanent" | "transient";

const PERMANENT_STATUSES = new Set([400, 401, 403, 404, 422]);

function statusOf(error: unknown): number | undefined {
  if (error === null || typeof error !== "object") return undefined;
  const direct = (error as { status?: unknown }).status;
  if (typeof direct === "number") return direct;
  const nested = (error as { response?: { status?: unknown } }).response?.status;
  return typeof nested === "number" ? nested : undefined;
}

export function classifyModelError(error: unknown): ModelErrorClass {
  if (
    error instanceof StrategyLimitError
    || error instanceof ConfigurationError
    || error instanceof ModelUnavailableError
    || (error instanceof Error && error.name === "AbortError")
  ) {
    return "abort";
  }
  const status = statusOf(error);
  if (status !== undefined && PERMANENT_STATUSES.has(status)) return "permanent";
  return "transient";
}
