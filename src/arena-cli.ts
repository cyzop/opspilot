import { z } from "zod";
import { DomainValidationError } from "./domain/errors.ts";
import { formatTrace, validateStrategyResult } from "./trace/trace.ts";
import type { StrategyResult } from "./trace/trace.ts";
import type { ReasoningStrategy } from "./strategies/strategy.ts";

export const strategyNameSchema = z.enum([
  "react",
  "plan-and-execute",
  "reflect:react",
  "reflect:plan-and-execute",
]);

const arenaOptionsSchema = z.object({
  input: z.string().trim().min(1, "Provide one non-empty question."),
  strategies: z.array(strategyNameSchema).min(1).refine(
    (strategies) => new Set(strategies).size === strategies.length,
    "Do not select a strategy more than once.",
  ),
  maxIterations: z.number().int().positive().safe(),
  maxReflection: z.number().int().nonnegative().safe(),
});

export interface ArenaOptions {
  help: boolean;
  input?: string;
  strategies: Array<z.infer<typeof strategyNameSchema>>;
  maxIterations: number;
  maxReflection: number;
}

export const ARENA_HELP = [
  "Usage: npm run arena -- [--strategies react,plan-and-execute,reflect:react,reflect:plan-and-execute] [--max-iterations <positive-integer>] [--max-reflection <non-negative-integer>] \"<question>\"",
  "",
  "Options:",
  "  --strategies       Comma-separated strategies (default: react,plan-and-execute)",
  "  --max-iterations   Maximum LLM calls per strategy (default: 8)",
  "  --max-reflection   Maximum answer regenerations (default: 2)",
  "  --help             Show this help",
].join("\n");

function parsePositiveInteger(value: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new DomainValidationError("--max-iterations must be a positive integer.");
  }
  return Number(value);
}

function parseNonNegativeInteger(value: string): number {
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new DomainValidationError("--max-reflection must be a non-negative integer.");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new DomainValidationError("--max-reflection must be a non-negative safe integer.");
  }
  return parsed;
}

export function parseArenaArgs(args: readonly string[]): ArenaOptions {
  if (args.length === 1 && args[0] === "--help") {
    return {
      help: true,
      strategies: ["react", "plan-and-execute"],
      maxIterations: 8,
      maxReflection: 2,
    };
  }

  const raw: {
    input?: string;
    strategies?: string[];
    maxIterations?: number;
    maxReflection?: number;
  } = {};
  const positional: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) continue;

    if (arg === "--help") {
      throw new DomainValidationError("--help must be used by itself.");
    }
    if (arg === "--strategies" || arg === "--max-iterations" || arg === "--max-reflection") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new DomainValidationError(`${arg} requires a value.`);
      }
      index += 1;
      if (arg === "--strategies") {
        raw.strategies = value.split(",").map((strategy) => strategy.trim()) as string[];
      } else if (arg === "--max-iterations") {
        raw.maxIterations = parsePositiveInteger(value);
      } else {
        raw.maxReflection = parseNonNegativeInteger(value);
      }
      continue;
    }
    if (arg.startsWith("--strategies=")) {
      raw.strategies = arg.slice("--strategies=".length).split(",").map((value) => value.trim());
      continue;
    }
    if (arg.startsWith("--max-iterations=")) {
      raw.maxIterations = parsePositiveInteger(arg.slice("--max-iterations=".length));
      continue;
    }
    if (arg.startsWith("--max-reflection=")) {
      raw.maxReflection = parseNonNegativeInteger(arg.slice("--max-reflection=".length));
      continue;
    }
    if (arg.startsWith("-")) {
      throw new DomainValidationError(`Unknown arena option: ${arg}`);
    }
    positional.push(arg);
  }

  if (positional.length !== 1) {
    throw new DomainValidationError("Provide exactly one quoted question as the positional input.");
  }

  const parsed = arenaOptionsSchema.safeParse({
    input: positional[0],
    strategies: raw.strategies ?? ["react", "plan-and-execute"],
    maxIterations: raw.maxIterations ?? 8,
    maxReflection: raw.maxReflection ?? 2,
  });
  if (!parsed.success) {
    throw new DomainValidationError(parsed.error.issues.map(({ message }) => message).join(" "));
  }
  return { help: false, ...parsed.data };
}

export function formatStrategyResult(name: string, result: StrategyResult): string {
  const validated = validateStrategyResult(result);
  const trace = formatTrace(validated.trace);
  return [
    `Strategy: ${name}`,
    `Answer: ${validated.answer}`,
    "Trace:",
    trace.length > 0 ? trace : "(no events)",
    `Metrics: llmCalls: ${validated.metrics.llmCalls}, latencyMs: ${validated.metrics.latencyMs}`,
  ].join("\n");
}

export type StrategyFactory = (
  name: ArenaOptions["strategies"][number],
  maxIterations: number,
  store: unknown,
  maxReflection: number,
) => ReasoningStrategy;
