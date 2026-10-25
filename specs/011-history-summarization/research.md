# Research: History Summarization

All decisions were resolved from the repository (feature 007 conversation store, feature 010
token metrics, existing trace/redaction code). No external research was required; no new
dependencies are introduced.

## R1. Coverage cursor instead of counters

- **Decision**: Track summary coverage by `coveredUntilMessageId` (the highest message id
  condensed) plus `coveredMessageCount`. Unsummarized messages are `messages.id > cursor`
  (cursor = 0 when there is no summary).
- **Rationale**: Message ids are monotonic per database (`AUTOINCREMENT`) and already
  ordered by `(conversation_id, id)` index; an id cursor is exact, survives restarts and
  makes the threshold a pure function of the unsummarized list.
- **Alternatives considered**: Counting total messages and storing a covered count only —
  breaks if messages are ever deleted and needs extra queries to locate the batch.

## R2. Pure history planning

- **Decision**: `planHistory(unsummarized, { window: 8, batch: 8 })` (pure) returns
  `{ recent, pending, batch }` where `recent` = last 8 unsummarized messages, `pending` =
  the rest (older, not yet summarized), and `batch` = `pending` when `pending.length >= 8`,
  else `[]`.
- **Rationale**: Coverage only ever advances over messages that already left the window,
  so the last 8 messages are always unsummarized; the whole decision is deterministic and
  unit-testable without I/O (constitution I). Summarizing the *entire* pending set (not just
  8) covers the edge case where earlier attempts failed.
- **Alternatives considered**: Summarizing exactly 8 and leaving extras pending — leaves a
  growing backlog after failures.

## R3. When and where summarization runs

- **Decision**: Synchronously inside the `/chat` request, after loading history and before
  composing the prompt, within the existing `withRequestTimeout` operation. Orchestrated by
  a service `prepareConversationHistory()` in `src/context/conversation-history.ts`.
- **Rationale**: The spec requires the fresh summary to be used on the same turn and the
  `summarize` event to appear in that response. Keeping the controller thin and the
  orchestration in a service follows MVC.
- **Alternatives considered**: Background (after response) like the learning reflector —
  the summary would be one turn late and the trace event could not be reported.

## R4. Summarizer interface and default implementation

- **Decision**: `type HistorySummarizer = (input: { previousSummary: string | null; messages:
  readonly { role; content }[]; targetTokens: number }) => Promise<string>`. Default
  `createLlmHistorySummarizer()` lazily calls `createModel()` and `invoke([SystemMessage,
  HumanMessage])`, returning the text. Tests inject a deterministic fake.
- **Rationale**: Plain text output is sufficient (validated afterwards with Zod: trimmed,
  non-empty, ≤ 302 estimated tokens). Lazy model creation means a missing OpenRouter config
  surfaces as a summarization failure, not a server boot failure.
- **Prompt**: pt-BR/English-neutral system instruction: "Merge the previous summary with the
  new messages into one summary of about 151 tokens. Preserve decisions taken, operational
  facts (services, alerts, incidents, IDs) and pending items/next steps. Drop small talk.
  Never include secrets." Human message: previous summary (or "none") + redacted messages.
- **Alternatives considered**: `withStructuredOutput({ summary })` — adds schema overhead
  for a single string.

## R5. Persistence and concurrency

- **Decision**: New table `conversation_summaries` in the same SQLite database, created by
  `SqliteConversationStore` alongside `conversations`/`messages`:
  `conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE`,
  `summary TEXT NOT NULL CHECK (length(trim(summary)) > 0)`,
  `covered_until_message_id INTEGER NOT NULL`, `covered_message_count INTEGER NOT NULL`,
  `estimated_tokens INTEGER NOT NULL`, `updated_at TEXT NOT NULL`.
  `saveSummary` uses `INSERT ... ON CONFLICT(conversation_id) DO UPDATE ... WHERE
  excluded.covered_until_message_id > conversation_summaries.covered_until_message_id` and
  returns whether a row changed.
- **Rationale**: Same store and DB file as the messages (constitution: `node:sqlite`,
  `OPSPILOT_DB`, `:memory:` in tests). The conditional upsert enforces FR-012 atomically even
  when two async requests interleave around the `await summarizer(...)`.
- **Alternatives considered**: Separate summary store class — more wiring for one table
  tightly coupled to messages.

## R6. Failure handling

- **Decision**: Any summarizer error, timeout-free rejection, or invalid output → keep the
  previous summary, keep pending messages verbatim in context, emit `summarize` event with
  `status: "failed"`, and `console.error` (established operational logging, as the learning
  reflector does). The chat turn proceeds.
- **Rationale**: Spec FR-008; the failure is explicit in the response and logs, not hidden.

## R7. Trace event shape

- **Decision**: Extend `traceEventSchema` with
  `{ type: "summarize", content: string, status: "ok" | "failed", messages: int ≥ 0,
  estimatedTokens: int ≥ 0 | null }` (strict). The server prepends it to the strategy trace
  in the response.
- **Rationale**: Structured fields make FR-007 testable; `content` keeps `formatTrace` and
  arena output readable without changes.

## R8. Context composition and metrics

- **Decision**: `composeChatContext(message, history, memoryFacts, summary?)` adds a
  `summary` section rendered as `Conversation summary (older messages):\n<text>` between
  memory and history. History section renders `pending + recent` (oldest first).
  `contextBreakdownSchema` gains `summary`, and `total` includes it. `historyMessages` =
  `pending.length + recent.length`. `MAX_HISTORY_MESSAGES` is replaced by
  `RECENT_WINDOW_MESSAGES = 8` and `SUMMARY_BATCH_MESSAGES = 8`.
- **Rationale**: Matches FR-006/FR-011 and keeps the prompt byte-identical to today when
  there is no summary and ≤ 8 history messages.
- **Note**: The summarizer's own model call is **not** added to `promptTokens`/`llmCalls`
  (those measure the assistant's reasoning); its estimated output size is reported in the
  `summarize` event.

## R9. Redaction

- **Decision**: Apply `sanitizeTraceText` to each message content before sending to the
  summarizer and to the summarizer output before validation/persistence.
- **Rationale**: Reuses the project's existing secret patterns (FR-009).
