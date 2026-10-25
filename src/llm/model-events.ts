import { AsyncLocalStorage } from "node:async_hooks";

export interface ModelFallbackReport {
  readonly primaryModel: string;
  readonly reserveModel: string;
  readonly reason: string;
}

// Model instances are shared across turns, so per-turn fallback reports travel with the
// async context of the caller (a graph node) instead of living in the model.
const scope = new AsyncLocalStorage<ModelFallbackReport[]>();

/**
 * Runs `fn` in a fresh scope. Pass `fallbacks` to keep the reports even when `fn` throws.
 */
export async function collectModelFallbacks<T>(
  fn: () => Promise<T>,
  fallbacks: ModelFallbackReport[] = [],
): Promise<{ value: T; fallbacks: ModelFallbackReport[] }> {
  const value = await scope.run(fallbacks, fn);
  return { value, fallbacks };
}

/** Records a model switch in the current scope; no-op outside one (arena, bench, MCP). */
export function reportModelFallback(report: ModelFallbackReport): void {
  scope.getStore()?.push(report);
}
