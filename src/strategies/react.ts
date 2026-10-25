import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { GraphRecursionError } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { z } from "zod";
import { createModel } from "../llm/model.ts";
import type { OpsStore } from "../store/ops-store.ts";
import { createOpsStore } from "../store/ops-store.ts";
import { createOpsTools } from "../tools/index.ts";
import { StrategyLimitError } from "../domain/errors.ts";
import { createUsageRecorder } from "../context/tokens.ts";
import { createRunContext, type ReasoningStrategy } from "./strategy.ts";
import { sanitizeTraceEvent, validateStrategyResult, type TraceEvent } from "../trace/trace.ts";
import { isApprovalRequired } from "../approval/approval-errors.ts";
import { ApprovalAwareToolNode } from "./approval-tool-node.ts";

export interface ReactStrategyOptions {
  maxIterations: number;
  store?: OpsStore;
  model?: BaseChatModel;
  tools?: readonly StructuredToolInterface[];
  agentRunner?: (
    input: string,
    beforeModelCall: () => void,
    callbacks?: readonly object[],
  ) => Promise<readonly BaseMessage[]>;
  now?: () => number;
}

function messageText(message: BaseMessage): string {
  if (typeof message.content === "string") {
    return message.content;
  }
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => {
        if (part !== null && typeof part === "object" && "text" in part) {
          return String(part.text);
        }
        return "";
      })
      .join("");
  }
  return "";
}

function eventsFromMessages(messages: readonly BaseMessage[]): TraceEvent[] {
  const events: TraceEvent[] = [];
  for (const message of messages) {
    if (message instanceof AIMessage) {
      const toolCalls = message.tool_calls ?? [];
      if (toolCalls.length > 0) {
        events.push({ type: "thought", content: "The model selected an operational tool." });
        for (const call of toolCalls) {
          events.push(sanitizeTraceEvent({
            type: "action",
            content: `Requested tool ${call.name}`,
            tool: call.name,
            args: call.args,
          }));
        }
      } else if (messageText(message).trim() !== "") {
        events.push(sanitizeTraceEvent({
          type: "answer",
          content: messageText(message),
        }));
      }
      continue;
    }
    if (message instanceof ToolMessage) {
      const content = messageText(message);
      const status = message.status === "error" ? "Tool returned an error" : "Tool result";
      events.push(sanitizeTraceEvent({
        type: "observation",
        content: `${status}: ${content}`,
      }));
    }
  }
  return events;
}

function lastAnswer(messages: readonly BaseMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message instanceof AIMessage && (message.tool_calls?.length ?? 0) === 0) {
      const text = messageText(message).trim();
      if (text !== "") return text;
    }
  }
  return "";
}

function isRecursionLimit(error: unknown): boolean {
  return error instanceof GraphRecursionError
    || (error instanceof Error && error.name === "GraphRecursionError");
}

function toolArguments(input: unknown): Record<string, unknown> {
  if (typeof input === "string") {
    try {
      const parsed: unknown = JSON.parse(input);
      return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }
  return input !== null && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
}

export function createReactStrategy(options: ReactStrategyOptions): ReasoningStrategy {
  const maxIterations = z.number().int().positive().safe().parse(options.maxIterations);

  return {
    name: "react",
    async run(input) {
      const context = createRunContext(maxIterations, options.now);
      const usage = createUsageRecorder();
      const store = options.store ?? createOpsStore();
      const tools = options.tools ?? Object.values(createOpsTools(store));
      let budgetExceeded = false;
      let messages: BaseMessage[] = [];
      const callbackToolEvents: TraceEvent[] = [];
      const beforeModelCall = () => {
        try {
          context.recordLlmCall();
        } catch (error) {
          budgetExceeded = true;
          throw error;
        }
      };
      const callbacks = [{
        handleChatModelStart() {
          beforeModelCall();
        },
        handleToolStart(
          tool: { name?: string; id?: string[] },
          input: unknown,
          _runId?: string,
          _parentRunId?: string,
          _tags?: string[],
          _metadata?: Record<string, unknown>,
          runName?: string,
        ) {
          // The serialized tool has no name for DynamicStructuredTool; runName is the tool name.
          const name = runName ?? tool.name ?? tool.id?.at(-1) ?? "unknown_tool";
          callbackToolEvents.push(
            { type: "thought", content: "The model selected an operational tool." },
            {
              type: "action",
              content: `Requested tool ${name}`,
              tool: name,
              args: toolArguments(input),
            },
          );
        },
        handleToolEnd(output: unknown) {
          callbackToolEvents.push({
            type: "observation",
            content: `Tool result: ${typeof output === "string" ? output : JSON.stringify(output)}`,
          });
        },
        handleToolError(error: Error) {
          // A paused tool did not fail; the approval event is added by the graph.
          if (isApprovalRequired(error)) return;
          callbackToolEvents.push({
            type: "observation",
            content: `Tool returned an error: ${error.message}`,
          });
        },
      }, usage.handler];

      try {
        if (options.agentRunner) {
          messages = [...await options.agentRunner(input, beforeModelCall, callbacks)];
        } else {
          const agent = createReactAgent({
            llm: options.model ?? createModel(),
            tools: new ApprovalAwareToolNode([...tools]),
          });
          const stream = await agent.stream(
            { messages: [new HumanMessage(input)] },
            {
              streamMode: "values",
              recursionLimit: Math.min(
                Number.MAX_SAFE_INTEGER,
                Math.max(25, maxIterations * 4 + 10),
              ),
              callbacks,
            },
          );
          for await (const state of stream) {
            messages = state.messages;
          }
        }
      } catch (error) {
        if (isApprovalRequired(error)) {
          error.trace = callbackToolEvents.map(sanitizeTraceEvent);
          error.metrics = { ...context.metrics(), promptTokens: usage.promptTokens() };
          throw error;
        }
        if (!budgetExceeded && !isRecursionLimit(error)) {
          throw error;
        }
        if (isRecursionLimit(error) && context.llmCalls < maxIterations) {
          throw error;
        }
        if (error instanceof StrategyLimitError) {
          budgetExceeded = true;
        }
      }

      const messageEvents = eventsFromMessages(messages);
      const callbackEvents = callbackToolEvents.map(sanitizeTraceEvent);
      const trace = callbackEvents.length > 0 ? callbackEvents : messageEvents;
      const answer = lastAnswer(messages)
        || (budgetExceeded || context.llmCalls >= maxIterations
          ? `Reasoning stopped at the configured limit of ${maxIterations} model calls.`
          : `Reasoning stopped at the configured graph limit of ${maxIterations} model calls.`);
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

export const reactStrategy = createReactStrategy({ maxIterations: 8 });
