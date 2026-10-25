import { z } from "zod";
import type { ConversationMessage, ConversationRole } from "../domain/domain.ts";
import type { ConversationStore } from "../store/conversation-store.ts";
import { sanitizeTraceText, type TraceEvent } from "../trace/trace.ts";
import { estimateTokens } from "./tokens.ts";
import { logEvent } from "../obs/logger.ts";

export const RECENT_WINDOW_MESSAGES = 8;
export const SUMMARY_BATCH_MESSAGES = 8;
export const SUMMARY_TARGET_TOKENS = 151;
export const SUMMARY_MAX_TOKENS = 302;

export interface SummarizerMessage {
  readonly role: ConversationRole;
  readonly content: string;
}

export interface SummarizerInput {
  readonly previousSummary: string | null;
  readonly messages: readonly SummarizerMessage[];
  readonly targetTokens: number;
}

export type HistorySummarizer = (input: SummarizerInput) => Promise<string>;

export interface HistoryPlan {
  readonly recent: readonly ConversationMessage[];
  readonly pending: readonly ConversationMessage[];
  readonly batch: readonly ConversationMessage[];
}

export type SummarizeEvent = Extract<TraceEvent, { type: "summarize" }>;

export interface PreparedHistory {
  readonly summary: string | null;
  readonly messages: readonly ConversationMessage[];
  readonly event: SummarizeEvent | null;
}

export interface PrepareHistoryOptions {
  readonly store: ConversationStore;
  readonly conversationId: string;
  readonly summarizer: HistorySummarizer;
  readonly now?: () => Date;
}

export const summaryTextSchema = z.string().trim().min(1).refine(
  (text) => estimateTokens(text) <= SUMMARY_MAX_TOKENS,
  { message: `Summary exceeds ${SUMMARY_MAX_TOKENS} estimated tokens.` },
);

export function planHistory(
  unsummarized: readonly ConversationMessage[],
  options: { window?: number; batch?: number } = {},
): HistoryPlan {
  const window = options.window ?? RECENT_WINDOW_MESSAGES;
  const batchSize = options.batch ?? SUMMARY_BATCH_MESSAGES;
  const splitAt = Math.max(0, unsummarized.length - window);
  const pending = unsummarized.slice(0, splitAt);
  return {
    recent: unsummarized.slice(splitAt),
    pending,
    batch: pending.length >= batchSize ? pending : [],
  };
}

export async function prepareConversationHistory(options: PrepareHistoryOptions): Promise<PreparedHistory> {
  const { store, conversationId, summarizer } = options;
  const now = options.now ?? (() => new Date());
  const previous = store.getSummary(conversationId);
  const plan = planHistory(store.messagesAfter(conversationId, previous?.coveredUntilMessageId ?? 0));
  const lastBatchMessage = plan.batch.at(-1);
  if (!lastBatchMessage) {
    return { summary: previous?.summary ?? null, messages: [...plan.pending, ...plan.recent], event: null };
  }

  let summary: string;
  try {
    const output = await summarizer({
      previousSummary: previous?.summary ?? null,
      messages: plan.batch.map(({ role, content }) => ({ role, content: sanitizeTraceText(content) })),
      targetTokens: SUMMARY_TARGET_TOKENS,
    });
    summary = summaryTextSchema.parse(sanitizeTraceText(output));
  } catch (error) {
    const reason = sanitizeTraceText(error instanceof z.ZodError
      ? error.issues.map(({ message }) => message).join("; ")
      : error instanceof Error ? error.message : String(error));
    logEvent("warn", "summarization_failed", { node: "context", conversationId });
    return {
      summary: previous?.summary ?? null,
      messages: [...plan.pending, ...plan.recent],
      event: {
        type: "summarize",
        status: "failed",
        messages: plan.batch.length,
        estimatedTokens: null,
        content: `Summarization failed; previous summary kept: ${reason}`,
      },
    };
  }
  const event: SummarizeEvent = {
    type: "summarize",
    status: "ok",
    messages: plan.batch.length,
    estimatedTokens: estimateTokens(summary),
    content: `Summarized ${plan.batch.length} older messages into ~${estimateTokens(summary)} tokens.`,
  };
  const saved = store.saveSummary({
    conversationId,
    summary,
    coveredUntilMessageId: lastBatchMessage.id,
    coveredMessageCount: (previous?.coveredMessageCount ?? 0) + plan.batch.length,
    estimatedTokens: estimateTokens(summary),
    updatedAt: now().toISOString(),
  });
  if (!saved) {
    // A concurrent turn already stored a summary with equal or greater coverage; use it.
    const current = store.getSummary(conversationId);
    const unsummarized = store.messagesAfter(conversationId, current?.coveredUntilMessageId ?? 0);
    return { summary: current?.summary ?? null, messages: unsummarized, event };
  }
  return { summary, messages: plan.recent, event };
}
