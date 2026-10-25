import type { ConversationMessage } from "../domain/domain.ts";
import { buildContext, UNLIMITED_CONTEXT_BUDGET, type BuiltContext } from "../context/context-builder.ts";

export type ChatContext = Pick<BuiltContext, "prompt" | "sections">;

// Unbudgeted composition; memory facts keep their given order (treated as descending relevance).
export function composeChatContext(
  message: string,
  history: readonly ConversationMessage[],
  memoryFacts: readonly string[] = [],
  summary: string | null = null,
): ChatContext {
  const { prompt, sections } = buildContext({
    message,
    history,
    summary,
    memories: memoryFacts.map((fact, index) => ({ fact, score: memoryFacts.length - index })),
    budget: UNLIMITED_CONTEXT_BUDGET,
  });
  return { prompt, sections };
}

export function composeChatPrompt(
  message: string,
  history: readonly ConversationMessage[],
  memoryFacts: readonly string[] = [],
  summary: string | null = null,
): string {
  return composeChatContext(message, history, memoryFacts, summary).prompt;
}
