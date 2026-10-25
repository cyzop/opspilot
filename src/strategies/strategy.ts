import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { Tool } from "@langchain/core/tools";
import { z } from "zod";
import { StrategyLimitError } from "../domain/errors.ts";
import type { StrategyResult, TraceEvent } from "../trace/trace.ts";

export interface ReasoningStrategy {
  readonly name: StrategyName;
  run(input: string): Promise<StrategyResult>;
}

export type StrategyName = "react" | "plan-and-execute";

export interface StrategyDependencies {
  readonly model: BaseChatModel;
  readonly tools: readonly Tool[];
  readonly maxIterations: number;
  readonly now?: () => number;
}

export interface RunContext {
  readonly startedAt: number;
  readonly maxIterations: number;
  readonly events: TraceEvent[];
  readonly llmCalls: number;
  recordLlmCall(): void;
  invoke<T>(operation: () => Promise<T>): Promise<T>;
  metrics(): { llmCalls: number; latencyMs: number };
}

export function createRunContext(
  maxIterations: number,
  now: () => number = Date.now,
): RunContext {
  const iterationLimit = z.number().int().positive().safe().parse(maxIterations);
  let llmCalls = 0;
  const startedAt = now();
  const events: TraceEvent[] = [];
  const recordLlmCall = () => {
    if (llmCalls >= iterationLimit) {
      throw new StrategyLimitError(`Maximum model invocation count (${iterationLimit}) reached`);
    }
    llmCalls += 1;
  };

  return {
    startedAt,
    maxIterations: iterationLimit,
    events,
    get llmCalls() {
      return llmCalls;
    },
    recordLlmCall,
    async invoke<T>(operation: () => Promise<T>): Promise<T> {
      recordLlmCall();
      return operation();
    },
    metrics() {
      return {
        llmCalls,
        latencyMs: Math.max(0, now() - startedAt),
      };
    },
  };
}
