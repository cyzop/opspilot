import assert from "node:assert/strict";
import test from "node:test";
import { alertFixtures, serviceFixtures } from "../../src/store/seed-data.ts";
import { createOpsStore, type OpsStore } from "../../src/store/ops-store.ts";
import type { ReasoningStrategy } from "../../src/strategies/strategy.ts";
import { buildContext, DEFAULT_CONTEXT_BUDGET } from "../../src/context/context-builder.ts";

const built = (question: string | undefined) =>
  buildContext({ message: question ?? "", budget: DEFAULT_CONTEXT_BUDGET }).prompt;
import {
  BENCH_SCENARIOS,
  formatBenchTable,
  parseBenchArgs,
  runBench,
  type BenchDependencies,
  type BenchRow,
} from "../../src/bench.ts";

function createBenchStore(): OpsStore {
  return createOpsStore({
    seed: {
      services: serviceFixtures,
      alerts: alertFixtures,
      incidents: [],
    },
  });
}

function makeResult(answer: string) {
  return {
    answer,
    trace: [{ type: "answer" as const, content: answer }],
    metrics: { llmCalls: 3, latencyMs: 42 },
  };
}

test("parses scenario selection and no-replanner options", () => {
  assert.deepEqual(parseBenchArgs(["--scenario", "c2", "--no-replanner"]), {
    scenario: "C2",
    noReplanner: true,
    help: false,
  });
  assert.deepEqual(parseBenchArgs(["--scenario=c3"]), {
    scenario: "C3",
    noReplanner: false,
    help: false,
  });
  assert.equal(parseBenchArgs([]).scenario, "all");
  assert.equal(parseBenchArgs(["--help"]).help, true);
});

test("rejects missing, repeated, and invalid benchmark options", () => {
  for (const args of [
    ["--scenario"],
    ["--scenario", "c4"],
    ["--scenario", "c1", "--scenario", "c2"],
    ["--no-replanner", "--no-replanner"],
    ["--unknown"],
    ["--help", "--no-replanner"],
  ]) {
    assert.throws(() => parseBenchArgs(args), { name: "DomainValidationError" });
  }
});

test("runs all six scenario/strategy pairs and scores each from resulting store state", async () => {
  const noReplannerValues: boolean[] = [];
  const dependencies: BenchDependencies = {
    createStore: createBenchStore,
    createStrategy(_name, store, noReplanner): ReasoningStrategy {
      noReplannerValues.push(noReplanner);
      return {
        name: _name,
        async run(input) {
          if (input === built(BENCH_SCENARIOS[1]?.input)) {
            for (const service of ["checkout", "payments", "catalog"]) {
              store.openIncident({
                title: `${service} sev2 incident`,
                service,
                severity: "high",
              });
            }
            const first = store.listIncidents()[0];
            assert.ok(first);
            store.resolveIncident(first.id);
            return makeResult("Created and resolved the requested incidents.");
          }
          if (input === built(BENCH_SCENARIOS[2]?.input)) {
            const oldest = store.listAlerts("firing")
              .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
            assert.ok(oldest);
            store.openIncident({
              title: `Incident for ${oldest.title}`,
              service: oldest.serviceId,
              severity: "high",
            });
            return makeResult("The incident was opened; two alerts remain.");
          }
          return makeResult("One critical alert is firing.");
        },
      };
    },
  };

  const rows = await runBench(
    parseBenchArgs(["--no-replanner"]),
    dependencies,
  );
  assert.equal(rows.length, 6);
  assert.ok(rows.every(({ correct }) => correct));
  assert.deepEqual(rows.map(({ scenario, strategy }) => `${scenario}:${strategy}`), [
    "C1:react",
    "C1:plan-and-execute",
    "C2:react",
    "C2:plan-and-execute",
    "C3:react",
    "C3:plan-and-execute",
  ]);
  assert.ok(noReplannerValues.every(Boolean));
  assert.ok(rows.every(({ llmCalls, latencyMs }) => llmCalls === 3 && latencyMs === 42));
});

test("limits execution to the selected scenario", async () => {
  const executedInputs: string[] = [];
  const dependencies: BenchDependencies = {
    createStore: createBenchStore,
    createStrategy(name, _store) {
      return {
        name,
        async run(input) {
          executedInputs.push(input);
          return makeResult("Created the incidents.");
        },
      };
    },
  };
  const rows = await runBench(parseBenchArgs(["--scenario", "C2"]), dependencies);
  assert.equal(rows.length, 2);
  assert.ok(rows.every(({ scenario }) => scenario === "C2"));
  assert.deepEqual(executedInputs, [built(BENCH_SCENARIOS[1]?.input), built(BENCH_SCENARIOS[1]?.input)]);
});

test("formats the consolidated results with the requested table columns", () => {
  const rows: BenchRow[] = [{
    scenario: "C1",
    strategy: "react",
    correct: true,
    llmCalls: 2,
    latencyMs: 120,
  }];
  assert.equal(formatBenchTable(rows), [
    "| Cenário | Estratégia | Acerto | LLCalls | latencyMs |",
    "| ------- | ---------- | ------ | ------- | --------- |",
    "| C1      | react      | sim    | 2       | 120       |",
  ].join("\n"));
});
