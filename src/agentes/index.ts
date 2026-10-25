import { z } from "zod";
import { DomainValidationError, UnknownStrategyError } from "../domain/errors.ts";
import type { MemoryStore } from "../memory/memory-store.ts";
import { createPlanAndExecuteStrategy } from "../strategies/plan-and-execute.ts";
import { createReactStrategy } from "../strategies/react.ts";
import { withReflection } from "../strategies/reflection.ts";
import type { ReasoningStrategy } from "../strategies/strategy.ts";
import { createOpsStore, type OpsStore } from "../store/ops-store.ts";
import { createOpsTools } from "../tools/index.ts";

export const strategyNameSchema = z.enum(["react", "plan-and-execute"]);
export type SupportedStrategyName = z.infer<typeof strategyNameSchema>;

export interface StrategyRegistryOptions {
  store?: OpsStore;
  memoryStore?: MemoryStore;
  createReactStrategyFactory?: () => ReasoningStrategy;
  createPlanAndExecuteStrategyFactory?: () => ReasoningStrategy;
  withReflectionFactory?: (strategy: ReasoningStrategy, maxReflection: number) => ReasoningStrategy;
  defaultReflectionLimit?: number;
}

export interface StrategyRegistry {
  resolve(name: string, reflect?: boolean, maxReflection?: number): ReasoningStrategy;
}

export function createStrategyRegistry(options: StrategyRegistryOptions = {}): StrategyRegistry {
  const defaultReflectionLimit = options.defaultReflectionLimit ?? 2;
  const createReact = options.createReactStrategyFactory ?? (() => createReactStrategy({
    maxIterations: 8,
    ...(options.store ? { store: options.store } : {}),
    ...(options.memoryStore ? { tools: Object.values(createOpsTools(options.store ?? createOpsStore(), options.memoryStore)) } : {}),
  }));
  const createPlanAndExecute = options.createPlanAndExecuteStrategyFactory ?? (() => createPlanAndExecuteStrategy({
    maxIterations: 8,
    ...(options.store ? { store: options.store } : {}),
    ...(options.memoryStore ? { tools: Object.values(createOpsTools(options.store ?? createOpsStore(), options.memoryStore)) } : {}),
  }));
  const wrapWithReflection = options.withReflectionFactory ?? ((strategy, maxReflection) => withReflection(strategy, { maxReflection }));

  const registered = new Map<SupportedStrategyName, ReasoningStrategy>([
    ["react", createReact()],
    ["plan-and-execute", createPlanAndExecute()],
  ]);

  return {
    resolve(name, reflect = false, maxReflection = defaultReflectionLimit) {
      const normalizedName = name.startsWith("reflect:") ? name.slice("reflect:".length) : name;
      if (normalizedName !== "react" && normalizedName !== "plan-and-execute") {
        throw new UnknownStrategyError(`Unknown strategy: ${name}`);
      }

      const strategy = registered.get(normalizedName as SupportedStrategyName);
      if (!strategy) {
        throw new UnknownStrategyError(`Unknown strategy: ${name}`);
      }

      if (reflect) {
        return wrapWithReflection(strategy, maxReflection);
      }

      return strategy;
    },
  };
}

export const defaultStrategyRegistry = createStrategyRegistry();

export function resolveStrategy(
  name: string,
  reflect = false,
  maxReflection = 2,
  registry: StrategyRegistry = defaultStrategyRegistry,
): ReasoningStrategy {
  if (!Number.isInteger(maxReflection) || maxReflection < 0 || maxReflection > Number.MAX_SAFE_INTEGER) {
    throw new DomainValidationError("maxReflection must be a non-negative safe integer.");
  }

  return registry.resolve(name, reflect, maxReflection);
}
