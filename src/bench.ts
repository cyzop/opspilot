import { pathToFileURL } from "node:url";
import { alertSchema } from "./domain/domain.ts";
import { DomainValidationError } from "./domain/errors.ts";
import { buildContext, loadContextBudget } from "./context/context-builder.ts";
import { createModel } from "./llm/model.ts";
import { alertFixtures, serviceFixtures } from "./store/seed-data.ts";
import { createOpsStore, type OpsStore } from "./store/ops-store.ts";
import { createPlanAndExecuteStrategy } from "./strategies/plan-and-execute.ts";
import { createReactStrategy } from "./strategies/react.ts";
import type { ReasoningStrategy } from "./strategies/strategy.ts";
import { validateStrategyResult, type StrategyResult } from "./trace/trace.ts";

export type BenchScenarioId = "C1" | "C2" | "C3";
export type BenchStrategyName = "react" | "plan-and-execute";

export interface BenchScenario {
  id: BenchScenarioId;
  input: string;
}

export interface BenchOptions {
  scenario: BenchScenarioId | "all";
  noReplanner: boolean;
  help: boolean;
}

export interface BenchRow {
  scenario: BenchScenarioId;
  strategy: BenchStrategyName;
  correct: boolean;
  llmCalls: number;
  latencyMs: number;
}

export interface BenchDependencies {
  createStore(): OpsStore;
  createStrategy(
    name: BenchStrategyName,
    store: OpsStore,
    noReplanner: boolean,
  ): ReasoningStrategy;
}

export const BENCH_SCENARIOS: readonly BenchScenario[] = [
  { id: "C1", input: "Quantos alertas críticos estão disparando?" },
  {
    id: "C2",
    input: "Abra três incidentes sev2 para checkout, payment e catalog, nessa mesma ordem, e resolva o primeiro. Neste sistema, sev2 corresponde à severidade high.",
  },
  {
    id: "C3",
    input: "Dos alertas disparando, abra um incidente para o mais antigo e diga quantos sobraram.",
  },
];

const BENCH_HELP = [
  "Usage: npm run bench -- [--scenario C1|C2|C3|all] [--no-replanner]",
  "",
  "Options:",
  "  --scenario       Scenario to run (default: all)",
  "  --no-replanner   Execute the initial plan without replanning after each action",
  "  --help           Show this help",
].join("\n");

const scenarioSchema = (value: string): BenchOptions["scenario"] => {
  const normalized = value.toUpperCase();
  if (normalized === "ALL") return "all";
  if (normalized === "C1" || normalized === "C2" || normalized === "C3") return normalized;
  throw new DomainValidationError("--scenario must be one of C1, C2, C3, or all.");
};

export function parseBenchArgs(args: readonly string[]): BenchOptions {
  let scenario: BenchOptions["scenario"] = "all";
  let noReplanner = false;
  let help = false;
  let scenarioSeen = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help") {
      if (args.length !== 1) {
        throw new DomainValidationError("--help must be used by itself.");
      }
      help = true;
      continue;
    }
    if (argument === "--no-replanner") {
      if (noReplanner) {
        throw new DomainValidationError("--no-replanner must not be repeated.");
      }
      noReplanner = true;
      continue;
    }
    if (argument === "--scenario") {
      if (scenarioSeen) {
        throw new DomainValidationError("--scenario must not be repeated.");
      }
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new DomainValidationError("--scenario requires a value.");
      }
      scenario = scenarioSchema(value);
      scenarioSeen = true;
      index += 1;
      continue;
    }
    if (argument?.startsWith("--scenario=")) {
      if (scenarioSeen) {
        throw new DomainValidationError("--scenario must not be repeated.");
      }
      scenario = scenarioSchema(argument.slice("--scenario=".length));
      scenarioSeen = true;
      continue;
    }
    throw new DomainValidationError(`Unknown benchmark option: ${argument}`);
  }

  return { scenario, noReplanner, help };
}

function hasCount(text: string, count: number): boolean {
  const normalized = text.toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
  const portuguese: Record<number, string[]> = {
    0: ["zero", "nenhum", "nenhuma", "no"],
    1: ["um", "uma", "one"],
    2: ["dois", "duas", "two"],
    3: ["tres", "three"],
  };
  const tokens = [String(count), ...(portuguese[count] ?? [])];
  return tokens.some((token) => new RegExp(`\\b${token}\\b`, "u").test(normalized));
}

function isCorrect(
  scenario: BenchScenarioId,
  result: StrategyResult,
  store: OpsStore,
  initialIncidentIds: ReadonlySet<string>,
  initialFiringAlertIds: ReadonlySet<string>,
): boolean {
  const newIncidents = store.listIncidents().filter(({ id }) => !initialIncidentIds.has(id));

  if (scenario === "C1") {
    const criticalFiring = store.listAlerts("firing")
      .filter(({ severity }) => severity === "critical").length;
    return hasCount(result.answer, criticalFiring);
  }

  if (scenario === "C2") {
    const expectedServices = ["checkout", "payments", "catalog"];
    return newIncidents.length === expectedServices.length
      && newIncidents.every((incident, index) => incident.serviceId === expectedServices[index]
        && incident.severity === "high"
        && incident.status === (index === 0 ? "resolved" : "open"));
  }

  const oldestAlert = store.listAlerts("firing")
    .filter(({ id }) => initialFiringAlertIds.has(id))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt)
      || left.id.localeCompare(right.id))[0];
  if (!oldestAlert || newIncidents.length !== 1) return false;

  const remainingAlerts = store.listAlerts("firing")
    .filter(({ id }) => id !== oldestAlert.id).length;
  return newIncidents[0]?.serviceId === oldestAlert.serviceId
    && hasCount(result.answer, remainingAlerts);
}

export function formatBenchTable(rows: readonly BenchRow[]): string {
  const headers = ["Cenário", "Estratégia", "Acerto", "LLCalls", "latencyMs"];
  const values = rows.map((row) => [
    row.scenario,
    row.strategy,
    row.correct ? "sim" : "não",
    String(row.llmCalls),
    String(row.latencyMs),
  ]);
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...values.map((row) => row[index]?.length ?? 0)));
  const line = (cells: readonly string[]) =>
    `| ${cells.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join(" | ")} |`;
  return [
    line(headers),
    `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`,
    ...values.map(line),
  ].join("\n");
}

export async function runBench(
  options: BenchOptions,
  dependencies: BenchDependencies,
): Promise<BenchRow[]> {
  const selectedScenarios = options.scenario === "all"
    ? BENCH_SCENARIOS
    : BENCH_SCENARIOS.filter(({ id }) => id === options.scenario);
  const rows: BenchRow[] = [];
  const contextBudget = loadContextBudget();

  for (const scenario of selectedScenarios) {
    for (const strategyName of ["react", "plan-and-execute"] as const) {
      const store = dependencies.createStore();
      const initialIncidentIds = new Set(store.listIncidents().map(({ id }) => id));
      const initialFiringAlertIds = new Set(
        store.listAlerts("firing").map(({ id }) => id),
      );
      const strategy = dependencies.createStrategy(
        strategyName,
        store,
        options.noReplanner,
      );
      const result = validateStrategyResult(await strategy.run(buildContext({ message: scenario.input, budget: contextBudget }).prompt));
      rows.push({
        scenario: scenario.id,
        strategy: strategyName,
        correct: isCorrect(
          scenario.id,
          result,
          store,
          initialIncidentIds,
          initialFiringAlertIds,
        ),
        llmCalls: result.metrics.llmCalls,
        latencyMs: result.metrics.latencyMs,
      });
    }
  }
  return rows;
}

function createBenchmarkStore(): OpsStore {
  return createOpsStore({
    seed: {
      services: serviceFixtures,
      alerts: alertFixtures.map((alert) => alertSchema.parse(alert)),
      incidents: [],
    },
  });
}

function createBenchmarkDependencies(): BenchDependencies {
  return {
    createStore: createBenchmarkStore,
    createStrategy(name, store, noReplanner) {
      const model = createModel();
      if (name === "react") {
        return createReactStrategy({ maxIterations: 8, store, model });
      }
      return createPlanAndExecuteStrategy({
        maxIterations: 8,
        store,
        model,
        replanAfterEachStep: !noReplanner,
      });
    },
  };
}

export async function runBenchCli(args: readonly string[]): Promise<number> {
  try {
    const options = parseBenchArgs(args);
    if (options.help) {
      process.stdout.write(`${BENCH_HELP}\n`);
      return 0;
    }
    const rows = await runBench(options, createBenchmarkDependencies());
    process.stdout.write(`${formatBenchTable(rows)}\n`);
    return rows.every(({ correct }) => correct) ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : "An unexpected error occurred.";
    process.stderr.write(`Benchmark error: ${message}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runBenchCli(process.argv.slice(2));
}
