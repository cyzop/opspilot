import assert from "node:assert/strict";
import test from "node:test";
import { createOpsStore } from "../../src/store/ops-store.ts";
import { createOpsTools } from "../../src/tools/index.ts";
import {
  createPlanAndExecuteStrategy,
  type PlanStep,
} from "../../src/../src/strategies/plan-and-execute.ts";

const steps: PlanStep[] = [
  {
    description: "List firing alerts",
    tool: "list_alerts",
    args: { status: "firing" },
  },
  {
    description: "Open a checkout incident",
    tool: "open_incidente",
    args: { title: "Checkout errors", service: "checkout", severity: "high" },
  },
];

test("plans, executes one step at a time, replans, and reports metrics", async () => {
  const replanInputs: Array<{ remainingSteps: PlanStep[]; done: [string, string][] }> = [];
  const strategy = createPlanAndExecuteStrategy({
    store: createOpsStore(),
    maxIterations: 4,
    planner: async () => ({ steps }),
    executor: async (step) => `Executed ${step.tool}`,
    replanner: async ({ remainingSteps, done }) => {
      replanInputs.push({ remainingSteps, done });
      return replanInputs.length === 1
        ? { decision: "adjust", steps: [steps[1] as PlanStep] }
        : { decision: "finish", steps: [], answer: "Firing alerts were found and an incident was opened." };
    },
    now: (() => {
      let time = 10;
      return () => time++;
    })(),
  });

  const result = await strategy.run("Triage the current firing alerts");
  assert.equal(strategy.name, "plan-and-execute");
  assert.equal(result.answer, "Firing alerts were found and an incident was opened.");
  assert.deepEqual(replanInputs.map(({ remainingSteps }) => remainingSteps.length), [1, 0]);
  assert.deepEqual(replanInputs[0]?.done, [["List firing alerts", "Executed list_alerts"]]);
  assert.deepEqual(replanInputs[1]?.done, [
    ["List firing alerts", "Executed list_alerts"],
    ["Open a checkout incident", "Executed open_incidente"],
  ]);
  assert.deepEqual(result.trace.map(({ type }) => type), [
    "plan",
    "action",
    "observation",
    "critique",
    "plan",
    "action",
    "observation",
    "critique",
    "plan",
    "answer",
  ]);
  assert.equal(result.metrics.llmCalls, 3);
  assert.equal(result.metrics.latencyMs, 1);
});

test("accepts incident-list and runbook lookup steps in a plan", async () => {
  const executedTools: string[] = [];
  const strategy = createPlanAndExecuteStrategy({
    store: createOpsStore(),
    maxIterations: 2,
    planner: async () => ({
      steps: [
        {
          description: "List open incidents",
          tool: "list_incidentes",
          args: {},
        },
        {
          description: "Consult the payments runbook",
          tool: "consultar_runbook",
          args: { service: "payments" },
        },
      ],
    }),
    executor: async (step) => {
      executedTools.push(step.tool);
      return step.tool;
    },
    replanAfterEachStep: false,
  });

  await strategy.run("Check incidents and the payments runbook");
  assert.deepEqual(executedTools, ["list_incidentes", "consultar_runbook"]);
});

test("stops on the shared LLM budget", async () => {
  let executed = 0;
  const manySteps = Array.from({ length: 12 }, (_, index): PlanStep => ({
    description: `Step ${index + 1}`,
    tool: "list_alerts",
    args: { status: "firing" },
  }));
  const strategy = createPlanAndExecuteStrategy({
    store: createOpsStore(),
    maxIterations: 3,
    planner: async () => ({ steps: manySteps }),
    executor: async () => {
      executed += 1;
      return "step completed";
    },
    replanner: async () => ({ decision: "continue", steps: [] }),
  });

  const result = await strategy.run("Run the plan");
  assert.equal(executed, 3);
  assert.equal(result.metrics.llmCalls, 3);
  assert.match(result.answer, /limit/i);
  assert.equal(result.trace.filter(({ type }) => type === "action").length, 3);
});

test("resolves planned tool names and passes tool output to the replanner", async () => {
  let done: [string, string][] = [];
  const store = createOpsStore();
  const strategy = createPlanAndExecuteStrategy({
    store,
    tools: Object.values(createOpsTools(store)),
    maxIterations: 2,
    planner: async () => ({ steps: [steps[0] as PlanStep] }),
    replanner: async (input) => {
      done = input.done;
      return { decision: "finish", steps: [], answer: "Listed current firing alerts." };
    },
  });

  const result = await strategy.run("List current alerts");
  assert.equal(result.answer, "Listed current firing alerts.");
  assert.equal(done.length, 1);
  assert.equal(done[0]?.[0], "List firing alerts");
  assert.equal(JSON.parse(done[0]?.[1] ?? "null").length, 3);
  assert.deepEqual(result.trace.map(({ type }) => type), [
    "plan",
    "action",
    "observation",
    "critique",
    "plan",
    "answer",
  ]);
});

test("executes remaining planned steps without replanning when configured", async () => {
  const executions: string[] = [];
  let replannerCalls = 0;
  const strategy = createPlanAndExecuteStrategy({
    store: createOpsStore(),
    maxIterations: 4,
    replanAfterEachStep: false,
    planner: async () => ({ steps }),
    executor: async (step) => {
      executions.push(step.description);
      return `Completed ${step.description}`;
    },
    replanner: async () => {
      replannerCalls += 1;
      throw new Error("replanner should be bypassed");
    },
  });

  const result = await strategy.run("Run the complete initial plan");
  assert.deepEqual(executions, ["List firing alerts", "Open a checkout incident"]);
  assert.equal(replannerCalls, 0);
  assert.equal(result.metrics.llmCalls, 1);
  assert.deepEqual(result.trace.map(({ type }) => type), [
    "plan",
    "action",
    "observation",
    "action",
    "observation",
    "answer",
  ]);
});

test("never executes more than eight planned actions", async () => {
  let executed = 0;
  const manySteps = Array.from({ length: 12 }, (_, index): PlanStep => ({
    description: `Step ${index + 1}`,
    tool: "list_alerts",
    args: { status: "firing" },
  }));
  const strategy = createPlanAndExecuteStrategy({
    store: createOpsStore(),
    maxIterations: 20,
    planner: async () => ({ steps: manySteps }),
    executor: async () => {
      executed += 1;
      return "step completed";
    },
    replanner: async () => ({ decision: "continue", steps: [] }),
  });

  const result = await strategy.run("Execute every allowed step");
  assert.equal(executed, 8);
  assert.equal(result.metrics.llmCalls, 9);
  assert.equal(result.trace.filter(({ type }) => type === "action").length, 8);
  assert.notEqual(result.answer, "");
});

test("rejects invalid plans and ends immediately when the planner has no work", async () => {
  const invalid = createPlanAndExecuteStrategy({
    store: createOpsStore(),
    maxIterations: 2,
    planner: async () => ({
      steps: [{ description: "bad", tool: "list_alerts", args: { status: "unknown" } }],
    }),
    executor: async () => "unused",
    replanner: async () => ({ decision: "finish", steps: [] }),
  });
  await assert.rejects(invalid.run("Run an invalid plan"));

  const empty = createPlanAndExecuteStrategy({
    store: createOpsStore(),
    maxIterations: 2,
    planner: async () => ({ steps: [], answer: "Nothing requires action." }),
    executor: async () => "unused",
    replanner: async () => ({ decision: "finish", steps: [] }),
  });
  const result = await empty.run("Check whether work is needed");
  assert.equal(result.answer, "Nothing requires action.");
  assert.deepEqual(result.trace.map(({ type }) => type), ["plan", "answer"]);
});

function usageResult(inputTokens: number): unknown {
  return {
    generations: [[{ text: "", message: { usage_metadata: { input_tokens: inputTokens, output_tokens: 1, total_tokens: inputTokens + 1 } } }]],
  };
}

test("reports promptTokens summed over planner and replanner usage", async () => {
  const strategy = createPlanAndExecuteStrategy({
    store: createOpsStore(),
    maxIterations: 4,
    planner: async (_question, callbacks) => {
      for (const callback of callbacks ?? []) callback.handleLLMEnd(usageResult(200));
      return { steps: [steps[0] as PlanStep] };
    },
    executor: async (step) => `Executed ${step.tool}`,
    replanner: async (_state, callbacks) => {
      for (const callback of callbacks ?? []) callback.handleLLMEnd(usageResult(80));
      return { decision: "finish", steps: [], answer: "Done." };
    },
  });

  const result = await strategy.run("Triage the current firing alerts");
  assert.equal(result.metrics.llmCalls, 2);
  assert.equal(result.metrics.promptTokens, 280);
});

test("reports promptTokens as null when planners report no usage", async () => {
  const strategy = createPlanAndExecuteStrategy({
    store: createOpsStore(),
    maxIterations: 4,
    planner: async () => ({ steps: [], answer: "Nothing to do." }),
  });

  const result = await strategy.run("Anything to do?");
  assert.equal(result.metrics.promptTokens, null);
});

test("under the /chat approval policy a resolve_incident step pauses the plan", async () => {
  const { runWithApprovalPolicy, HTTP_APPROVAL_POLICY } = await import("../../src/approval/approval-context.ts");
  const { ApprovalRequiredError } = await import("../../src/approval/approval-errors.ts");
  const store = createOpsStore();
  let replans = 0;
  const strategy = createPlanAndExecuteStrategy({
    store,
    tools: Object.values(createOpsTools(store)),
    maxIterations: 4,
    planner: async () => ({
      steps: [
        steps[0] as PlanStep,
        { description: "Resolve the incident", tool: "resolve_incident", args: { id: "incident-001" } },
      ],
    }),
    replanner: async () => {
      replans += 1;
      return { decision: "continue", steps: [] };
    },
  });
  const error = await runWithApprovalPolicy(HTTP_APPROVAL_POLICY, () => strategy.run("Resolva"))
    .then(() => undefined, (caught: unknown) => caught);
  assert.ok(error instanceof ApprovalRequiredError);
  assert.deepEqual(error.trace.map(({ type }) => type), ["plan", "action", "observation", "critique", "plan", "action"]);
  assert.equal(error.trace.at(-1)?.type === "action" && error.trace.at(-1)?.type === "action" ? (error.trace.at(-1) as { tool: string }).tool : "", "resolve_incident");
  assert.ok(error.metrics);
  assert.equal(replans, 1);
});
