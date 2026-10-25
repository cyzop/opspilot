import { z } from "zod";
import { ConfigurationError, DomainValidationError } from "../domain/errors.ts";
import type { RequestRecord } from "../store/request-store.ts";

const UNIT_MS = { m: 60_000, h: 3_600_000, d: 86_400_000 } as const;
const MAX_WINDOW_MS = 365 * UNIT_MS.d;
export const DEFAULT_SINCE = "24h";

/** `30m`, `24h`, `7d` → milliseconds (default 24h; at most 365d). */
export function parseSince(since: string | undefined): number {
  const match = /^([1-9]\d*)([mhd])$/.exec(since ?? DEFAULT_SINCE);
  const amount = Number(match?.[1]);
  const ms = match ? amount * UNIT_MS[match[2] as keyof typeof UNIT_MS] : Number.NaN;
  if (!Number.isFinite(ms) || ms > MAX_WINDOW_MS) {
    throw new DomainValidationError("since must look like 30m, 24h or 7d (at most 365d).");
  }
  return ms;
}

/** Nearest-rank percentile; null for an empty list. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1] ?? null;
}

/** OpenRouter free variants (`…:free`) and the free router cost nothing. */
export function isFreeModel(model: string): boolean {
  return model.endsWith(":free") || model === "openrouter/free";
}

/** USD per 1M prompt tokens, keyed by model id. */
export type ModelPrices = Readonly<Record<string, number>>;
const modelPricesSchema = z.record(z.string().min(1), z.number().finite().nonnegative());

export function loadModelPrices(env: { OPSPILOT_MODEL_PRICES?: string } = process.env): ModelPrices {
  const raw = env.OPSPILOT_MODEL_PRICES?.trim();
  if (!raw) return {};
  try {
    return modelPricesSchema.parse(JSON.parse(raw));
  } catch {
    throw new ConfigurationError(
      'OPSPILOT_MODEL_PRICES must be JSON like {"openai/gpt-4o-mini":0.15} (USD per 1M prompt tokens).',
    );
  }
}

export interface GroupStats {
  total: number;
  errors: number;
  promptTokens: number;
  /** Prompt-token cost estimate; null when every priced-able request used an unpriced model. */
  costUsd: number | null;
  latencyMs: { p50: number | null; p95: number | null };
}

export interface RequestStats extends GroupStats {
  errorRate: number;
  requestsWithoutTokens: number;
  unpricedModels: string[];
  byRoute: Record<string, GroupStats>;
  byModel: Record<string, GroupStats>;
}

// Cost of one request: 0 for free models, null when the model has no price.
function requestCost(record: RequestRecord, prices: ModelPrices): number | null {
  const metrics = record.metrics;
  if (!metrics || metrics.promptTokens === null) return 0;
  if (isFreeModel(metrics.modelUsed)) return 0;
  const price = prices[metrics.modelUsed];
  return price === undefined ? null : (metrics.promptTokens / 1_000_000) * price;
}

const round = (value: number) => Math.round(value * 1e6) / 1e6;

function groupStats(records: readonly RequestRecord[], prices: ModelPrices): GroupStats {
  const costs = records.map((record) => requestCost(record, prices));
  const priced = costs.filter((cost): cost is number => cost !== null);
  const durations = records.map(({ durationMs }) => durationMs);
  return {
    total: records.length,
    errors: records.filter(({ status }) => status >= 400).length,
    promptTokens: records.reduce((sum, { metrics }) => sum + (metrics?.promptTokens ?? 0), 0),
    costUsd: priced.length === 0 && costs.length > 0 ? null : round(priced.reduce((sum, cost) => sum + cost, 0)),
    latencyMs: { p50: percentile(durations, 50), p95: percentile(durations, 95) },
  };
}

function groupBy(records: readonly RequestRecord[], key: (record: RequestRecord) => string) {
  const groups = new Map<string, RequestRecord[]>();
  for (const record of records) {
    const name = key(record);
    groups.set(name, [...(groups.get(name) ?? []), record]);
  }
  return groups;
}

/** Aggregates stored requests (pure). Errors have no metrics, so their model is `unknown`. */
export function computeStats(records: readonly RequestRecord[], prices: ModelPrices): RequestStats {
  const overall = groupStats(records, prices);
  const toObject = (groups: Map<string, RequestRecord[]>) => Object.fromEntries(
    [...groups].map(([name, group]) => [name, groupStats(group, prices)]),
  );
  const unpriced = new Set(
    records
      .filter((record) => requestCost(record, prices) === null)
      .map((record) => record.metrics?.modelUsed ?? "unknown"),
  );
  return {
    ...overall,
    // Overall cost counts the priced requests even when some models are unpriced.
    costUsd: round(records.reduce((sum, record) => sum + (requestCost(record, prices) ?? 0), 0)),
    errorRate: records.length === 0 ? 0 : overall.errors / records.length,
    requestsWithoutTokens: records.filter(({ metrics }) => metrics !== null && metrics.promptTokens === null).length,
    unpricedModels: [...unpriced].sort(),
    byRoute: toObject(groupBy(records, ({ route }) => route ?? "none")),
    byModel: toObject(groupBy(records, ({ metrics }) => metrics?.modelUsed ?? "unknown")),
  };
}
