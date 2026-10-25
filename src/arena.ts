import { pathToFileURL } from "node:url";
import { ARENA_HELP, formatStrategyResult, parseArenaArgs } from "./arena-cli.ts";
import { DomainValidationError } from "./domain/errors.ts";
import { buildContext, loadContextBudget } from "./context/context-builder.ts";
import type { ReasoningStrategy } from "./strategies/strategy.ts";
import type { StrategyResult } from "./trace/trace.ts";
import type { ArenaOptions } from "./arena-cli.ts";
import type { OpsStore } from "./store/ops-store.ts";
import type { StrategyName } from "./strategies/strategy.ts";

export interface ArenaRunnerDependencies {
  createStore(): object;
  createStrategy(
    name: ArenaOptions["strategies"][number],
    maxIterations: number,
    store: object,
    maxReflection: number,
  ): ReasoningStrategy;
  write(text: string): void;
}

export interface ArenaStrategyFactories<Store extends object = object> {
  createBase(
    name: StrategyName,
    maxIterations: number,
    store: Store,
  ): ReasoningStrategy;
  withReflection(strategy: ReasoningStrategy, maxReflection: number): ReasoningStrategy;
}

export function createArenaStrategy<Store extends object>(
  name: ArenaOptions["strategies"][number],
  maxIterations: number,
  maxReflection: number,
  store: Store,
  factories: ArenaStrategyFactories<Store>,
): ReasoningStrategy {
  const reflected = name.startsWith("reflect:");
  const baseName = reflected ? name.slice("reflect:".length) : name;
  if (baseName !== "react" && baseName !== "plan-and-execute") {
    throw new DomainValidationError(`Unsupported arena strategy: ${name}`);
  }
  const strategy = factories.createBase(baseName, maxIterations, store);
  return reflected ? factories.withReflection(strategy, maxReflection) : strategy;
}

function isOpsStore(store: object): store is OpsStore {
  return "listAlerts" in store
    && typeof store.listAlerts === "function"
    && "openIncident" in store
    && typeof store.openIncident === "function"
    && "resolveIncident" in store
    && typeof store.resolveIncident === "function";
}

export async function runArena(
  options: ArenaOptions,
  dependencies: ArenaRunnerDependencies,
): Promise<StrategyResult[]> {
  if (options.help) {
    dependencies.write(ARENA_HELP);
    return [];
  }
  if (options.input === undefined) {
    throw new DomainValidationError("Provide one non-empty question.");
  }

  const results: StrategyResult[] = [];
  const prompt = buildContext({ message: options.input, budget: loadContextBudget() }).prompt;
  for (const name of options.strategies) {
    const strategy = dependencies.createStrategy(
      name,
      options.maxIterations,
      dependencies.createStore(),
      options.maxReflection,
    );
    const result = await strategy.run(prompt);
    const output = formatStrategyResult(name, result);
    dependencies.write(output);
    results.push(result);
  }
  return results;
}

export async function runArenaCli(args: readonly string[]): Promise<number> {
  try {
    const options = parseArenaArgs(args);
    if (options.help) {
      process.stdout.write(`${ARENA_HELP}\n`);
      return 0;
    }

    const [
      { createOpsStore },
      { createReactStrategy },
      { createPlanAndExecuteStrategy },
      { createModel },
      { withReflection },
    ] =
      await Promise.all([
        import("./store/ops-store.ts"),
        import("./strategies/react.ts"),
        import("./strategies/plan-and-execute.ts"),
        import("./llm/model.ts"),
        import("./strategies/reflection.ts"),
      ]);

    await runArena(options, {
      createStore: () => createOpsStore(),
      createStrategy(name, maxIterations, store, maxReflection) {
        if (!isOpsStore(store)) {
          throw new Error("Arena store factory returned an invalid operations store.");
        }
        const reflected = name.startsWith("reflect:");
        const model = reflected ? createModel() : undefined;
        return createArenaStrategy(name, maxIterations, maxReflection, store, {
          createBase(baseName, iterationLimit, baseStore) {
            const strategyOptions = {
              maxIterations: iterationLimit,
              store: baseStore,
              ...(model ? { model } : {}),
            };
            return baseName === "react"
              ? createReactStrategy(strategyOptions)
              : createPlanAndExecuteStrategy(strategyOptions);
          },
          withReflection(strategy, reflectionLimit) {
            return withReflection(strategy, {
              maxReflection: reflectionLimit,
              ...(model ? { model } : {}),
            });
          },
        });
      },
      write: (text) => process.stdout.write(`${text}\n\n`),
    });
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : "An unexpected error occurred.";
    process.stderr.write(`Arena error: ${message}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runArenaCli(process.argv.slice(2));
}
