# Data Model: History Summarization

## ConversationSummary (persisted — table `conversation_summaries`)

| Field (domain) | Column | Type | Rules |
|----------------|--------|------|-------|
| conversationId | conversation_id | TEXT PK, FK → conversations(id) ON DELETE CASCADE | one row per conversation |
| summary | summary | TEXT NOT NULL | trimmed, non-empty (`CHECK (length(trim(summary)) > 0)`), redacted, `estimateTokens(summary) <= 302` |
| coveredUntilMessageId | covered_until_message_id | INTEGER NOT NULL | positive int; highest message id condensed |
| coveredMessageCount | covered_message_count | INTEGER NOT NULL | positive int; cumulative messages condensed |
| estimatedTokens | estimated_tokens | INTEGER NOT NULL | `estimateTokens(summary)` |
| updatedAt | updated_at | TEXT NOT NULL | ISO-8601 datetime |

Zod: `conversationSummarySchema` in `src/domain/domain.ts` (strict).

**State transitions**: none → stored (first successful summarization) → replaced (each later
successful summarization with a strictly greater `coveredUntilMessageId`). Failed attempts
never change the row. Deleted with its conversation.

## ConversationStore (extended interface)

| Method | Behavior |
|--------|----------|
| `messagesAfter(conversationId, afterMessageId)` | all messages with `id > afterMessageId`, ascending; throws `UnknownConversationError` for unknown ids; `afterMessageId` int ≥ 0 |
| `getSummary(conversationId)` | `ConversationSummary \| undefined` (validated) |
| `saveSummary(summary)` | conditional upsert; returns `true` only if stored (new row or greater coverage) |

## HistoryPlan (value, pure)

`planHistory(unsummarized, { window = 8, batch = 8 })`:

| Field | Rule |
|-------|------|
| recent | last `min(window, n)` of `unsummarized` |
| pending | `unsummarized` minus `recent` (older first) |
| batch | `pending` when `pending.length >= batch`, else `[]` |

## SummarizerInput (value)

| Field | Type | Rule |
|-------|------|------|
| previousSummary | string \| null | stored summary text, or null |
| messages | `{ role: "user" \| "assistant"; content: string }[]` | the batch, contents redacted, length ≥ 8 |
| targetTokens | literal 151 | |

Output: string → `sanitizeTraceText` → `summaryTextSchema` (trimmed, non-empty, ≤ 302
estimated tokens); otherwise failure.

## PreparedHistory (service result)

| Field | Type |
|-------|------|
| summary | string \| null — summary used in this turn (new or previous) |
| messages | ConversationMessage[] — `pending` (if not summarized) + `recent` |
| event | SummarizeEvent \| null |

## SummarizeEvent (trace)

| Field | Type | Rule |
|-------|------|------|
| type | `"summarize"` | |
| status | `"ok" \| "failed"` | |
| messages | int ≥ 0 | messages condensed (or attempted) |
| estimatedTokens | int ≥ 0 \| null | size of the new summary; null on failure |
| content | string | human-readable, e.g. `Summarized 8 older messages into ~143 tokens.` / `Summarization failed; previous summary kept: <reason>` (redacted) |

## ContextBreakdown (extended from feature 010)

Adds `summary: int ≥ 0` (estimate of the rendered summary section); `total = history +
memory + summary + message`.

## Constants

`RECENT_WINDOW_MESSAGES = 8`, `SUMMARY_BATCH_MESSAGES = 8`, `SUMMARY_TARGET_TOKENS = 151`,
`SUMMARY_MAX_TOKENS = 302`.
