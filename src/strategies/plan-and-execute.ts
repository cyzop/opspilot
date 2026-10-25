import { isApprovalRequired } from "../approval/approval-errors.ts";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { END, GraphRecursionError, START, StateGraph, StateSchema } from "@langchain/langgraph";
import { z } from "zod";
import { createModel } from "../llm/model.ts";
import {
  alertFilterSchema,
  getRunbookInputSchema,
  listIncidentsInputSchema,
  openIncidentInputSchema,
  resolveIncidentInputSchema,
} from "../domain/domain.ts";
import { StrategyLimitError } from "../domain/errors.ts";
import { createUsageRecorder, type UsageCallback } from "../context/tokens.ts";
import type { OpsStore } from "../store/ops-store.ts";
import { createOpsStore } from "../store/ops-store.ts";
import { createOpsTools } from "../tools/index.ts";
import { createRunContext, type ReasoningStrategy } from "./strategy.ts";
import {
  sanitizeTraceEvent,
  traceEventSchema,
  validateStrategyResult,
  type TraceEvent,
} from "../trace/trace.ts";

const planStepSchema = z.discriminatedUnion("tool", [
  z.object({
    description: z.string().trim().min(1),
    tool: z.literal("list_alerts"),
    args: z.object({
      status: alertFilterSchema.describe("Filtro de alertas: firing, resolved ou all.").default("firing"),
    }).strict(),
  }).strict(),
  z.object({
    description: z.string().trim().min(1),
    tool: z.literal("list_incidentes"),
    args: listIncidentsInputSchema,
  }).strict(),
  z.object({
    description: z.string().trim().min(1),
    tool: z.literal("consultar_runbook"),
    args: getRunbookInputSchema,
  }).strict(),
  z.object({
    description: z.string().trim().min(1),
    tool: z.literal("open_incidente"),
    args: openIncidentInputSchema,
  }).strict(),
  z.object({
    description: z.string().trim().min(1),
    tool: z.literal("resolve_incident"),
    args: resolveIncidentInputSchema,
  }).strict(),
]);

export type PlanStep = z.infer<typeof planStepSchema>;

const planOutputSchema = z.object({
  steps: z.array(planStepSchema).max(32),
  answer: z.string().optional(),
}).strict();

export interface PlanOutput {
  steps: PlanStep[];
  answer?: string;
}

export interface ReplannerInput {
  input: string;
  done: [string, string][];
  remainingSteps: PlanStep[];
  lastObservation: string;
}

const replanOutputSchema = z.object({
  decision: z.enum(["adjust", "continue", "finish"]),
  steps: z.array(planStepSchema).max(32),
  answer: z.string().optional(),
}).strict();

export type ReplanOutput = z.infer<typeof replanOutputSchema>;

export interface PlanAndExecuteOptions {
  maxIterations: number;
  replanAfterEachStep?: boolean;
  store?: OpsStore;
  model?: BaseChatModel;
  tools?: readonly StructuredToolInterface[];
  planner?: (input: string, callbacks?: readonly UsageCallback[]) => Promise<unknown>;
  replanner?: (input: ReplannerInput, callbacks?: readonly UsageCallback[]) => Promise<unknown>;
  executor?: (step: PlanStep) => Promise<string>;
  now?: () => number;
}

const planState = new StateSchema({
  input: z.string(),
  steps: z.array(planStepSchema).default(() => []),
  done: z.array(z.tuple([z.string(), z.string()])).default(() => []),
  lastObservation: z.string().default(""),
  answer: z.string().default(""),
  trace: z.array(traceEventSchema).default(() => []),
  actions: z.number().int().nonnegative().default(0),
});

type PlanGraphState = typeof planState.State;

function boundedAnswer(maxIterations: number): string {
  return `Plan-and-Execute stopped at the configured limit of ${maxIterations} model calls.`;
}

function finalAnswer(trace: readonly TraceEvent[], fallback: string): string {
  return fallback.trim() || (trace.length > 0
    ? "The planned operations are complete."
    : "No operational steps were required.");
}

export function createPlanAndExecuteStrategy(options: PlanAndExecuteOptions): ReasoningStrategy {
  const maxIterations = z.number().int().positive().safe().parse(options.maxIterations);

  return {
    name: "plan-and-execute",
    async run(input) {
      const validatedInput = z.string().trim().min(1).parse(input);
      const context = createRunContext(maxIterations, options.now);
      const usage = createUsageRecorder();
      const usageCallbacks: readonly UsageCallback[] = [usage.handler];
      const store = options.store ?? createOpsStore();
      const tools = options.tools ?? Object.values(createOpsTools(store));
      let model = options.model;
      const getModel = (): BaseChatModel => {
        model ??= createModel();
        return model;
      };
      const planner = options.planner ?? (async (question: string, callbacks: readonly UsageCallback[] = []): Promise<unknown> => {
        const structuredModel = getModel().withStructuredOutput<PlanOutput>(planOutputSchema);
        const output = await structuredModel.invoke([
          new SystemMessage(
            "Plan safe on-call operations. Return concrete tool steps with validated arguments; use at most eight actions. Do not include private reasoning.",
          ),
          new HumanMessage(question),
        ], { callbacks: [...callbacks] });
        return planOutputSchema.parse(output);
      });
      const replanner = options.replanner ?? (async (state: ReplannerInput, callbacks: readonly UsageCallback[] = []): Promise<unknown> => {
        const structuredModel = getModel().withStructuredOutput<ReplanOutput>(replanOutputSchema);
        const output = await structuredModel.invoke([
          new SystemMessage(
            "Review the completed steps and their tool results. Choose exactly one decision: adjust the remaining steps and return the revised steps, continue with the existing remaining steps, or finish when no work remains. Include a concise answer only when finishing. Do not include private reasoning.",
          ),
          new HumanMessage(JSON.stringify(state)),
        ], { callbacks: [...callbacks] });
        return replanOutputSchema.parse(output);
      });
      const defaultExecutor = async (step: PlanStep): Promise<string> => {
        const target = toolByName.get(step.tool);
        if (!target) {
          throw new Error(`No tool is registered for plan step ${step.tool}.`);
        }
        const result = await target.invoke(step.args);
        return typeof result === "string" ? result : JSON.stringify(result);
      };
      const execute = options.executor ?? defaultExecutor;
      const replanAfterEachStep = options.replanAfterEachStep ?? true;
      const toolByName = new Map<string, StructuredToolInterface>(
        tools.map((registeredTool) => [registeredTool.name, registeredTool]),
      );

      const graph = new StateGraph(planState)
        .addNode("planner", async (state) => {
          const output = planOutputSchema.parse(await context.invoke(() => planner(state.input, usageCallbacks)));
          const steps = output.steps.slice(0, 8);
          const plannedTrace = sanitizeTraceEvent({
            type: "plan",
            content: JSON.stringify(steps),
          });
          const trace = [...state.trace, plannedTrace];
          return {
            steps,
            answer: steps.length === 0 ? finalAnswer(trace, output.answer ?? "") : "",
            trace,
          };
        })
        .addNode("executor", async (state) => {
          const step = state.steps[0];
          if (!step || state.actions >= 8) {
            return { steps: [], answer: "Plan stopped after the maximum of eight actions." };
          }
          const action = sanitizeTraceEvent({
            type: "action",
            content: step.description,
            tool: step.tool,
            args: step.args,
          });
          let observation: string;
          try {
            observation = await execute(step);
          } catch (error) {
            if (isApprovalRequired(error)) {
              error.trace = [...state.trace, action];
              throw error;
            }
            observation = error instanceof Error ? `Error: ${error.message}` : "Error: unknown tool failure";
          }
          const observationEvent = sanitizeTraceEvent({ type: "observation", content: observation });
          const completion: [string, string] = [step.description, observation];
          return {
            steps: state.steps.slice(1),
            done: [...state.done, completion],
            lastObservation: observation,
            actions: state.actions + 1,
            trace: [...state.trace, action, observationEvent],
          };
        })
        .addNode("replanner", async (state) => {
          const limitCritique = sanitizeTraceEvent({
            type: "critique",
            content: "Reviewing the result and remaining operational steps.",
          });
          let output: ReplanOutput;
          try {
            output = replanOutputSchema.parse(await context.invoke(() => replanner({
              input: state.input,
              done: state.done,
              remainingSteps: state.steps,
              lastObservation: state.lastObservation,
            }, usageCallbacks)));
          } catch (error) {
            if (!(error instanceof StrategyLimitError)) throw error;
            const trace = [...state.trace, limitCritique];
            return {
              steps: [],
              answer: boundedAnswer(maxIterations),
              trace,
            };
          }
          const availableActions = Math.max(0, 8 - state.actions);
          const proposedSteps = output.decision === "finish"
            ? []
            : output.decision === "continue"
              ? state.steps.slice(0, availableActions)
              : output.steps.slice(0, availableActions);
          const hitActionLimit = state.actions >= 8 && proposedSteps.length > 0;
          const steps = hitActionLimit ? [] : proposedSteps;
          const planEvent = sanitizeTraceEvent({
            type: "plan",
            content: JSON.stringify(steps),
          });
          const answer = hitActionLimit
            ? "Plan stopped after the maximum of eight actions."
            : steps.length === 0
              ? finalAnswer(state.trace, output.answer ?? "")
              : "";
          const decisionCritique = sanitizeTraceEvent({
            type: "critique",
            content: `Replanner decision: ${output.decision}.`,
          });
          return {
            steps,
            answer,
            trace: [...state.trace, decisionCritique, planEvent],
          };
        })
        .addEdge(START, "planner")
        .addConditionalEdges(
          "planner",
          (state) => state.steps.length > 0 && state.answer === "" ? "executor" : END,
          ["executor", END],
        )
        .addConditionalEdges(
          "executor",
          (state) => {
            if (state.answer !== "") return END;
            if (replanAfterEachStep) return "replanner";
            return state.steps.length > 0 && state.actions < 8 ? "executor" : END;
          },
          ["replanner", "executor", END],
        );

      if (replanAfterEachStep) {
        graph.addConditionalEdges(
          "replanner",
          (state) => state.steps.length > 0 && state.answer === "" && state.actions < 8
            ? "executor"
            : END,
          ["executor", END],
        );
      } else {
        graph.addEdge("replanner", END);
      }

      const compiledGraph = graph
        .compile();

      let state: PlanGraphState = {
        input: validatedInput,
        steps: [] as PlanStep[],
        done: [] as [string, string][],
        lastObservation: "",
        answer: "",
        trace: [] as PlanGraphState["trace"],
        actions: 0,
      };
      const stream = await compiledGraph.stream(state, {
        streamMode: "values",
        recursionLimit: Math.min(
          Number.MAX_SAFE_INTEGER,
          Math.max(25, maxIterations * 6 + 8),
        ),
      });
      try {
        for await (const next of stream) {
          state = next;
        }
      } catch (error) {
        if (isApprovalRequired(error)) {
          error.metrics = { ...context.metrics(), promptTokens: usage.promptTokens() };
          throw error;
        }
        if (!(error instanceof GraphRecursionError)) throw error;
        state = {
          ...state,
          answer: boundedAnswer(maxIterations),
          trace: [...state.trace, {
            type: "critique",
            content: "Plan stopped at the graph safety limit.",
          }],
        };
      }

      const answer = finalAnswer(state.trace, state.answer);
      const trace = [...state.trace];
      if (trace.at(-1)?.type !== "answer") {
        trace.push({ type: "answer", content: answer });
      } else {
        trace[trace.length - 1] = { type: "answer", content: answer };
      }
      return validateStrategyResult({
        answer,
        trace,
        metrics: { ...context.metrics(), promptTokens: usage.promptTokens() },
      });
    },
  };
}

export const planAndExecuteStrategy = createPlanAndExecuteStrategy({ maxIterations: 8 });
