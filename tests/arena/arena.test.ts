import assert from "node:assert/strict";
import test from "node:test";
import type { ReasoningStrategy } from "../../src/strategies/strategy.ts";
import type { StrategyResult } from "../../src/trace/trace.ts";
import { AIMessage } from "@langchain/core/messages";
import { createOpsStore, type OpsStore } from "../../src/store/ops-store.ts";
import { createOpsTools } from "../../src/tools/index.ts";
import { createReactStrategy } from "../../src/strategies/react.ts";
import { createPlanAndExecuteStrategy } from "../../src/strategies/plan-and-execute.ts";
import { createArenaStrategy, runArena, type ArenaRunnerDependencies } from "../../src/arena.ts";
import { withReflection } from "../../src/strategies/reflection.ts";
import { buildContext, DEFAULT_CONTEXT_BUDGET } from "../../src/context/context-builder.ts";

function result(name: string): StrategyResult {
  return {
    answer: `${name} answer`,
    trace: [{ type: "answer", content: `${name} answer` }],
    metrics: { llmCalls: 2, latencyMs: 10 },
  };
}

test("runs selected strategies in order with common input and independent stores", async () => {
  const calls: Array<{ name: string; input: string; maxIterations: number; store: object }> = [];
  const output: string[] = [];
  const stores: object[] = [];
  const strategies = ["plan-and-execute", "react"] as const;
  const dependencies: ArenaRunnerDependencies = {
    createStore() {
      const store = {};
      stores.push(store);
      return store;
    },
    createStrategy(name, maxIterations, store): ReasoningStrategy {
      const baseName = name === "react" || name === "reflect:react"
        ? "react"
        : "plan-and-execute";
      return {
        name: baseName,
        async run(input) {
          calls.push({ name, input, maxIterations, store });
          return result(name);
        },
      };
    },
    write: (text) => output.push(text),
  };

  const results = await runArena({
    help: false,
    input: "How is the on-call shift?",
    strategies: [...strategies],
    maxIterations: 3,
    maxReflection: 2,
  }, dependencies);

  assert.deepEqual(calls.map((call) => call.name), strategies);
  const builtInput = buildContext({ message: "How is the on-call shift?", budget: DEFAULT_CONTEXT_BUDGET }).prompt;
  assert.deepEqual(calls.map((call) => call.input), [builtInput, builtInput]);
  assert.deepEqual(calls.map((call) => call.maxIterations), [3, 3]);
  assert.notEqual(calls[0]?.store, calls[1]?.store);
  assert.equal(stores.length, 2);
  assert.match(output[0] ?? "", /plan-and-execute answer/);
  assert.match(output[0] ?? "", /llmCalls: 2/);
  assert.match(output[0] ?? "", /latencyMs: 10/);
  assert.deepEqual(results.map(({ answer }) => answer), ["plan-and-execute answer", "react answer"]);
});

test("stops and reports a strategy error rather than fabricating a result", async () => {
  const output: string[] = [];
  const dependencies: ArenaRunnerDependencies = {
    createStore: () => ({}),
    createStrategy(name): ReasoningStrategy {
      const baseName = name === "react" || name === "reflect:react"
        ? "react"
        : "plan-and-execute";
      return {
        name: baseName,
        async run() {
          throw new Error("model unavailable");
        },
      };
    },
    write: (text) => output.push(text),
  };

  await assert.rejects(
    runArena({
      help: false,
      input: "question",
      strategies: ["react"],
      maxIterations: 1,
      maxReflection: 2,
    }, dependencies),
    /model unavailable/,
  );
  assert.equal(output.length, 0);
});

test("wires both real strategy factories with fake dependencies and isolated stores", async () => {
  const stores = new Map<object, OpsStore>();
  const dependencies: ArenaRunnerDependencies = {
    createStore() {
      const store = createOpsStore();
      stores.set(store, store);
      return store;
    },
    createStrategy(name, maxIterations, rawStore) {
      const store = stores.get(rawStore);
      assert.ok(store);
      if (name === "react") {
        return createReactStrategy({
          store,
          tools: Object.values(createOpsTools(store)),
          maxIterations,
          agentRunner: async (_input, beforeModelCall) => {
            beforeModelCall();
            return [new AIMessage("ReAct completed.")];
          },
        });
      }
      return createPlanAndExecuteStrategy({
        store,
        maxIterations,
        planner: async () => ({ steps: [], answer: "Plan-and-Execute completed." }),
        executor: async () => "unused",
        replanner: async () => ({ steps: [] }),
      });
    },
    write() {},
  };

  const results = await runArena({
    help: false,
    input: "Compare the strategies",
    strategies: ["react", "plan-and-execute"],
    maxIterations: 4,
    maxReflection: 2,
  }, dependencies);
  assert.deepEqual(results.map(({ answer }) => answer), [
    "ReAct completed.",
    "Plan-and-Execute completed.",
  ]);
});

test("creates matching reflected strategy bases and applies reflection only when selected", () => {
  const calls: string[] = [];
  const baseStore = {};
  const reflectedStore = {};
  const factories = {
    createBase(name: "react" | "plan-and-execute", maxIterations: number, store: object) {
      calls.push(`base:${name}:${maxIterations}:${store === reflectedStore}`);
      return {
        name,
        async run(input: string) {
          return result(`${name}:${input}`);
        },
      };
    },
    withReflection(strategy: ReasoningStrategy, maxReflection: number) {
      calls.push(`reflect:${strategy.name}:${maxReflection}`);
      return strategy;
    },
  };

  createArenaStrategy("reflect:react", 4, 1, reflectedStore, factories);
  createArenaStrategy("reflect:plan-and-execute", 5, 2, reflectedStore, factories);
  createArenaStrategy("react", 6, 0, baseStore, factories);

  assert.deepEqual(calls, [
    "base:react:4:true",
    "reflect:react:1",
    "base:plan-and-execute:5:true",
    "reflect:plan-and-execute:2",
    "base:react:6:false",
  ]);
});

test("runs reflected selectors with isolated stores and prints critique metrics", async () => {
  const baseNames: string[] = [];
  const stores: object[] = [];
  const output: string[] = [];
  const dependencies: ArenaRunnerDependencies = {
    createStore() {
      const store = {};
      stores.push(store);
      return store;
    },
    createStrategy(name, maxIterations, store, maxReflection) {
      return createArenaStrategy(name, maxIterations, maxReflection, store, {
        createBase(baseName) {
          baseNames.push(baseName);
          return {
            name: baseName,
            async run(input) {
              return {
                answer: `${baseName} answer for ${input}`,
                trace: [{ type: "observation", content: "No active incidents." }],
                metrics: { llmCalls: 1, latencyMs: 2 },
              };
            },
          };
        },
        withReflection(strategy, reflectionLimit) {
          assert.equal(reflectionLimit, 0);
          return withReflection(strategy, {
            maxReflection: reflectionLimit,
            critic: async (_review, onModelCall) => {
              onModelCall();
              return { approved: true, feedback: "Supported by observation." };
            },
          });
        },
      });
    },
    write: (text) => output.push(text),
  };

  const results = await runArena({
    help: false,
    input: "Summarize incidents.",
    strategies: ["reflect:react", "reflect:plan-and-execute"],
    maxIterations: 3,
    maxReflection: 0,
  }, dependencies);

  assert.deepEqual(baseNames, ["react", "plan-and-execute"]);
  assert.notEqual(stores[0], stores[1]);
  assert.equal(results.length, 2);
  assert.match(output[0] ?? "", /Strategy: reflect:react/);
  assert.match(output[0] ?? "", /critique: approved/);
  assert.match(output[0] ?? "", /llmCalls: 2/);
  assert.match(output[1] ?? "", /Strategy: reflect:plan-and-execute/);
  assert.match(output[1] ?? "", /critique: approved/);
  assert.match(output[1] ?? "", /llmCalls: 2/);
});
