import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { z } from "zod";
import { createModel } from "../llm/model.ts";
import { learningReflectionSchema, validateLearningFact } from "../domain/domain.ts";
import { DomainValidationError } from "../domain/errors.ts";
import type { MemoryStore } from "../memory/memory-store.ts";
import type { ReasoningStrategy } from "./strategy.ts";
import { createUsageRecorder, sumPromptTokens, type UsageCallback } from "../context/tokens.ts";
import {
  sanitizeTraceEvent,
  sanitizeTraceText,
  validateStrategyResult,
  type StrategyResult,
  type TraceEvent,
} from "../trace/trace.ts";

export const reflectionVerdictSchema = z.object({
  approved: z.boolean(),
  feedback: z.string().trim().min(1),
}).strict();

export type ReflectionVerdict = z.infer<typeof reflectionVerdictSchema>;

export interface LearningReflectionContext {
  userId: string;
  message: string;
  memoryStore: MemoryStore;
  model?: BaseChatModel;
}

export async function reflectUserLearning(
  context: LearningReflectionContext,
): Promise<boolean> {
  const userId = context.userId.trim();
  const message = context.message.trim();
  if (!userId || !message) {
    return false;
  }

  const structuredModel = (context.model ?? createModel()).withStructuredOutput(
    learningReflectionSchema,
  );
  const result = learningReflectionSchema.parse(await structuredModel.invoke([
    new SystemMessage([
      "You are a durable-learning reflector for a user-specific memory system.",
      "Read only the latest user message and decide whether it contains a stable preference or durable context likely to remain useful across future conversations.",
      "Never store one-time requests, temporary operational state, prompts, secrets, credentials, tokens, or password-like content.",
      "Return { hasLearning: true, fact: '...' } only when the message contains a safe durable fact, otherwise return { hasLearning: false, fact: '' }.",
    ].join(" ")),
    new HumanMessage(message),
  ]));

  if (!result.hasLearning) {
    return false;
  }

  const fact = validateLearningFact(result.fact);
  if (!fact) {
    return false;
  }

  await context.memoryStore.remember(userId, fact);
  return true;
}

export interface ReflectionReviewInput {
  question: string;
  observations: string[];
  answer: string;
}

export interface ReflectionOptions {
  maxReflection?: number;
  model?: BaseChatModel;
  critic?: (
    input: ReflectionReviewInput,
    onModelCall: () => void,
    callbacks?: readonly UsageCallback[],
  ) => Promise<unknown>;
  now?: () => number;
}

const maxReflectionSchema = z.number().int().nonnegative().safe();

const CRITIC_PROMPT = [
  "You are OpsPilot's response critic.",
  "Evaluate the answer ONLY against the operator request and the provided tool observations.",
  "Do not infer facts that are absent from the observations and do not rely on hidden reasoning.",
  "Set approved=true only when the answer is supported by the observations and addresses the request.",
  "If approved, feedback should briefly state why the evidence supports the answer.",
  "If rejected, feedback must give specific, actionable corrections grounded in the observations.",
  "Never request or reveal secrets or private chain-of-thought.",
].join(" ");

function observationsOf(trace: readonly TraceEvent[]): string[] {
  return trace
    .filter((event) => event.type === "observation")
    .map(({ content }) => sanitizeTraceText(content));
}

function regenerationInput(
  question: string,
  observations: readonly string[],
  feedback: string,
): string {
  return [
    `Pedido: ${sanitizeTraceText(question)}`,
    `Observações: ${observations.map(sanitizeTraceText).join("\n")}`,
    `Feedback do crítico: ${sanitizeTraceText(feedback)}`,
    "Revise a resposta com base somente no pedido, observações e feedback acima.",
  ].join("\n\n");
}

function critiqueEvent(
  verdict: ReflectionVerdict,
  exhausted: boolean,
): TraceEvent {
  const status = verdict.approved
    ? "approved"
    : exhausted
      ? "not approved; reflection retry limit reached, no further regeneration"
      : "not approved; answer regeneration will follow";
  return sanitizeTraceEvent({
    type: "critique",
    content: `${status}. Feedback: ${sanitizeTraceText(verdict.feedback)}`,
  });
}

export function withReflection(
  strategy: ReasoningStrategy,
  options: ReflectionOptions = {},
): ReasoningStrategy {
  const maxReflection = options.maxReflection ?? 2;
  if (!maxReflectionSchema.safeParse(maxReflection).success) {
    throw new DomainValidationError("maxReflection must be a non-negative safe integer.");
  }
  const now = options.now ?? Date.now;

  return {
    name: strategy.name,
    async run(input) {
      const question = z.string().trim().min(1).parse(input);
      const startedAt = now();
      let model = options.model;
      let criticCalls = 0;
      let baseCalls = 0;
      const baseTokens: (number | null)[] = [];
      const usage = createUsageRecorder();
      let latest: StrategyResult | undefined;
      let lastFeedback = "";
      const trace: TraceEvent[] = [];
      const observations: string[] = [];
      const critic = options.critic ?? (async (
        review: ReflectionReviewInput,
        _onModelCall: () => void,
        callbacks: readonly UsageCallback[] = [],
      ): Promise<unknown> => {
        model ??= createModel();
        const structuredCritic = model.withStructuredOutput<ReflectionVerdict>(
          reflectionVerdictSchema,
        );
        return structuredCritic.invoke([
          new SystemMessage(CRITIC_PROMPT),
          new HumanMessage([
            `Pedido: ${sanitizeTraceText(review.question)}`,
            `Observações: ${review.observations.map(sanitizeTraceText).join("\n")}`,
            `Resposta: ${sanitizeTraceText(review.answer)}`,
          ].join("\n\n")),
        ], {
          callbacks: [{
            handleChatModelStart() {
              criticCalls += 1;
            },
          }, ...callbacks],
        });
      });

      for (let regeneration = 0; regeneration <= maxReflection; regeneration += 1) {
        latest = validateStrategyResult(
          await strategy.run(regeneration === 0
            ? question
            : regenerationInput(
              question,
              observations,
              lastFeedback,
            )),
        );
        baseCalls += latest.metrics.llmCalls;
        baseTokens.push(latest.metrics.promptTokens ?? null);
        trace.push(...latest.trace);
        observations.push(...observationsOf(latest.trace));

        const reviewInput: ReflectionReviewInput = {
          question: sanitizeTraceText(question),
          answer: sanitizeTraceText(latest.answer),
          observations: observationsOf(latest.trace),
        };
        const verdict = reflectionVerdictSchema.parse(await critic(
          reviewInput,
          () => {
            criticCalls += 1;
          },
          [usage.handler],
        ));
        lastFeedback = sanitizeTraceText(verdict.feedback);
        const exhausted = !verdict.approved && regeneration === maxReflection;
        trace.push(critiqueEvent(verdict, exhausted));
        if (verdict.approved || exhausted) break;
      }

      if (!latest) {
        throw new Error("Reflection completed without a strategy result.");
      }
      return validateStrategyResult({
        answer: latest.answer,
        trace,
        metrics: {
          llmCalls: baseCalls + criticCalls,
          promptTokens: sumPromptTokens([...baseTokens, usage.promptTokens()]),
          latencyMs: Math.max(0, now() - startedAt),
        },
      });
    },
  };
}
