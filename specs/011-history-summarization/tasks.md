---

description: "Task list for History Summarization"
---

# Tasks: History Summarization

**Input**: Design documents from `/specs/011-history-summarization/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/chat-summarization.md, quickstart.md

**Tests**: Requested explicitly ("com teste fake", FR-013, FR-014, constitution IV). Tests are written first in each phase and must fail before the implementation that satisfies them. No test may call a real model.

**Organization**: Tasks are grouped by user story so each story can be implemented and verified independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 = summary enters the context, US2 = merge/persist/batch-only refresh, US3 = `summarize` trace event, failure visibility and breakdown
- Paths are relative to the `ops-pilot/` project root

---

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 [P] Create `tests/helpers/fake-history-summarizer.ts` exporting `createFakeHistorySummarizer(options?: { output?: (input) => string; error?: Error })` that returns `{ summarizer, calls }`, where `summarizer` matches `HistorySummarizer` (`(input: { previousSummary: string | null; messages: readonly { role: "user" | "assistant"; content: string }[]; targetTokens: number }) => Promise<string>`), records every input in `calls`, rejects with `error` when given, and by default returns a deterministic merge: `[previousSummary, ...messages.map(m => \`${m.role}: ${m.content}\`)].filter(Boolean).join(" | ")` truncated to 600 characters
- [X] T002 [P] Create empty `src/context/conversation-history.ts` exporting constants `RECENT_WINDOW_MESSAGES = 8`, `SUMMARY_BATCH_MESSAGES = 8`, `SUMMARY_TARGET_TOKENS = 151`, `SUMMARY_MAX_TOKENS = 302`, and the `HistorySummarizer` / `SummarizerInput` types from data-model.md (so T001 type-checks)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Persistence for summaries and uncovered messages, used by every story.

**⚠️ CRITICAL**: Complete T003–T008 before any user story phase.

- [X] T003 Write failing tests in `tests/store/sqlite-conversation-store.test.ts`: `messagesAfter(id, 0)` returns all messages ascending; `messagesAfter(id, n)` returns only `id > n`; negative or non-integer `afterMessageId` throws `RangeError`; unknown conversation throws `UnknownConversationError`; `getSummary` is `undefined` initially; `saveSummary` stores and `getSummary` returns the validated record; `saveSummary` with lesser or equal `coveredUntilMessageId` returns `false` and keeps the stored row; greater coverage returns `true` and replaces it; a second `SqliteConversationStore` on the same temp file reads the stored summary; deleting the conversation row via `store._db` removes the summary (cascade)
- [X] T004 [P] Add `conversationSummarySchema` (strict) and `ConversationSummary` type to `src/domain/domain.ts` with fields `conversationId: conversationIdSchema`, `summary: z.string().trim().min(1)`, `coveredUntilMessageId: z.number().int().positive().safe()`, `coveredMessageCount: z.number().int().positive().safe()`, `estimatedTokens: z.number().int().nonnegative()`, `updatedAt: z.string().datetime()`
- [X] T005 Extend `ConversationStore` in `src/store/conversation-store.ts` with `messagesAfter(conversationId: string, afterMessageId: number): ConversationMessage[]`, `getSummary(conversationId: string): ConversationSummary | undefined`, `saveSummary(summary: ConversationSummary): boolean`
- [X] T006 In `src/store/sqlite-conversation-store.ts`, add to `schemaSql`: `CREATE TABLE IF NOT EXISTS conversation_summaries (conversation_id TEXT PRIMARY KEY NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, summary TEXT NOT NULL CHECK (length(trim(summary)) > 0), covered_until_message_id INTEGER NOT NULL, covered_message_count INTEGER NOT NULL, estimated_tokens INTEGER NOT NULL, updated_at TEXT NOT NULL)`
- [X] T007 Implement `messagesAfter`, `getSummary` (row → `conversationSummarySchema.parse`) and `saveSummary` (validate input; `INSERT ... ON CONFLICT(conversation_id) DO UPDATE SET ... WHERE excluded.covered_until_message_id > conversation_summaries.covered_until_message_id`; return `result.changes > 0`) in `src/store/sqlite-conversation-store.ts`. Makes T003 pass
- [X] T008 Run `npm run typecheck` and `npm test`; only the pre-existing feature-009 failures in `tests/learning-reflection.test.ts` may remain

**Checkpoint**: Summaries and uncovered messages can be stored and read.

---

## Phase 3: User Story 1 - Long conversations keep their important context (Priority: P1) 🎯 MVP

**Goal**: Keep the 8 most recent messages verbatim; when ≥ 8 messages that left the window are unsummarized, condense them into a summary (fake in tests) and put it in the context.

**Independent Test**: With the fake summarizer, a conversation with 16 prior messages produces a summary from exactly the oldest 8 and the next prompt contains the summary section, then the 8 recent messages, then the current message.

### Tests for User Story 1 (write first, must fail)

- [X] T009 [P] [US1] Create `tests/context/conversation-history.test.ts` with failing tests for pure `planHistory(unsummarized, { window: 8, batch: 8 })`: 0, 5 and 8 messages → `recent` = all, `pending` = [], `batch` = []; 15 messages → `recent` = last 8, `pending` = first 7, `batch` = []; 16 messages → `pending` = first 8 and `batch` = same 8; 20 messages → `batch` = first 12 (whole pending set)
- [X] T010 [P] [US1] Add failing tests in `tests/context/conversation-history.test.ts` for the service `prepareConversationHistory({ store, conversationId, summarizer, now })` using `SqliteConversationStore(":memory:")` and `createFakeHistorySummarizer`: with 14 prior messages the summarizer is not called and `messages` has 14 items, `summary` null; with 16 prior messages it is called once with `previousSummary: null`, `targetTokens: 151` and exactly the 8 oldest messages, returns `summary` = fake output and `messages` = the 8 recent; the summary is saved with `coveredUntilMessageId` = id of the 8th message and `coveredMessageCount: 8`; contents with `api_key=abc123` reach the summarizer as `api_key=[REDACTED]`, and a fake output containing `token: xyz` is stored redacted
- [X] T011 [P] [US1] Add failing tests in `tests/http/compose-chat-prompt.test.ts` for `composeChatContext(message, history, memoryFacts, summary)`: with a summary, sections render in the order memory → `Conversation summary (older messages):\n<summary>` → history → current message; `sections.summary` holds the rendered summary block and `""` when absent; prompt without summary and with ≤ 8 messages is byte-identical to the previous behavior
- [X] T012 [US1] Update `tests/http/server.test.ts`: rename/adjust "composes the latest 12 prior messages" to inject `summarizer` from `createFakeHistorySummarizer` and expect `historyMessages === 8`, a `Conversation summary (older messages):` section containing `Question 0`…`Question 3`, and history lines for `Question 4`…`Question 7`; update "composes all prior messages up to the 12-message limit" to use prior counts `[0, 4, 8, 14]` (no summarization) and expect all of them verbatim; add a test that 14 prior messages never call the fake summarizer

### Implementation for User Story 1

- [X] T013 [US1] Implement pure `planHistory` in `src/context/conversation-history.ts` per data-model.md ("recent = last min(window, n)"; "batch = pending when pending.length >= batch, else []"). Makes T009 pass
- [X] T014 [US1] Implement in `src/context/conversation-history.ts`: `summaryTextSchema = z.string().trim().min(1).refine((text) => estimateTokens(text) <= SUMMARY_MAX_TOKENS)`; `prepareConversationHistory({ store, conversationId, summarizer, now = () => new Date() })` that reads `getSummary`, loads `messagesAfter(id, summary?.coveredUntilMessageId ?? 0)`, plans, and when `batch` is non-empty calls the summarizer with `sanitizeTraceText`-redacted messages, redacts and validates the output, saves via `saveSummary` (`estimatedTokens: estimateTokens(text)`, `updatedAt: now().toISOString()`) and returns `{ summary, messages, event }` (`messages` = recent on success, pending + recent otherwise; `event` left `null` until US3). Makes T010 pass
- [X] T015 [P] [US1] Create `src/context/llm-history-summarizer.ts` exporting `createLlmHistorySummarizer(model?: BaseChatModel): HistorySummarizer` that lazily calls `createModel()` and `invoke([new SystemMessage(<prompt from research.md R4>), new HumanMessage(<previous summary or "none"> + numbered "User:/Assistant:" lines>)])`, returning the message text; no network in tests (not unit-tested against a live model)
- [X] T016 [US1] In `src/http/compose-chat-prompt.ts`, replace `MAX_HISTORY_MESSAGES` with re-exported `RECENT_WINDOW_MESSAGES` usage, add optional `summary?: string | null` parameter and `sections.summary`, render the summary block between memory and history, and remove the internal `.slice(-12)` (the caller now passes pending + recent). Makes T011 pass
- [X] T017 [US1] In `src/http/server.ts`, add `summarizer?: HistorySummarizer` to `ChatServerOptions` (default `createLlmHistorySummarizer()`), replace `lastMessages(..., MAX_HISTORY_MESSAGES)` with `prepareConversationHistory(...)` inside the timed operation (only when `conversationId` is given), pass `prepared.messages` and `prepared.summary` to `composeChatContext`, and set `historyMessages: prepared.messages.length`. Makes T012 pass
- [X] T018 [US1] Run `npm run typecheck` and `npm test`; fix remaining references to `MAX_HISTORY_MESSAGES` in `src/` and `tests/`

**Checkpoint**: Older messages are condensed and the summary is part of the prompt.

---

## Phase 4: User Story 2 - Summaries are merged, persisted and refreshed only in batches (Priority: P1)

**Goal**: Merge with the previous summary, persist, survive restart, and never summarize except when a new batch of 8 leaves the window.

**Independent Test**: With a counting fake summarizer over 20 simulated turns (40 messages), the summarizer runs exactly on turns 9, 13 and 17, each time receiving the previous summary plus only the new batch; a new store instance on the same file reuses the summary without a call.

### Tests for User Story 2 (write first, must fail)

- [X] T019 [P] [US2] Add failing tests in `tests/context/conversation-history.test.ts`: simulate 20 turns (call `prepareConversationHistory` then `store.append` a user/assistant pair each turn) → fake `calls.length === 3`, triggered on turns 9, 13 and 17 only, never on consecutive turns; the 2nd call has `previousSummary` equal to the 1st output and `messages` = exactly the 8 messages that left the window since the 1st; facts from the 1st batch are still in the summary after the 3rd call (default fake merge)
- [X] T020 [P] [US2] Add failing test in `tests/context/conversation-history.test.ts`: summarize on a temp-file store, close it, open a new `SqliteConversationStore` on the same file, call `prepareConversationHistory` with a fresh fake → zero calls and `summary` equals the persisted text
- [X] T021 [P] [US2] Add failing test in `tests/context/conversation-history.test.ts` for concurrency: two `prepareConversationHistory` calls for the same conversation started together with a fake whose promise resolves on demand → one `saveSummary` returns `false`; both results use the stored summary and the row's coverage is not reduced

### Implementation for User Story 2

- [X] T022 [US2] In `src/context/conversation-history.ts`, pass the stored summary text as `previousSummary`, set `coveredMessageCount = (previous?.coveredMessageCount ?? 0) + batch.length`, and when `saveSummary` returns `false` re-read `getSummary` and rebuild `messages` from `messagesAfter` with the newer coverage. Makes T019–T021 pass
- [X] T023 [US2] Run `npm run typecheck` and `npm test`

**Checkpoint**: Summaries accumulate across refreshes and restarts with batch-only refresh.

---

## Phase 5: User Story 3 - Summarization is visible in the trace (Priority: P2)

**Goal**: `summarize` trace event on success and failure, failures never fail the turn, and the breakdown reports the summary.

**Independent Test**: A threshold turn with the fake summarizer returns one `summarize` event first in the trace; a failing fake returns `status: "failed"` with HTTP 200 and the previous summary intact; non-threshold turns have no event; `contextBreakdown.summary` is reported.

### Tests for User Story 3 (write first, must fail)

- [X] T024 [P] [US3] Add failing tests in `tests/context/conversation-history.test.ts`: success → `event` = `{ type: "summarize", status: "ok", messages: 8, estimatedTokens: estimateTokens(summary), content: /Summarized 8 older messages/ }`; no batch → `event === null`; fake rejecting → `event.status === "failed"`, `estimatedTokens === null`, stored summary unchanged, `messages` = pending + recent, `console.error` called (stub via `context.mock.method(console, "error")`); fake returning 1300 characters (> 302 estimated tokens) or whitespace → treated as failed
- [X] T025 [P] [US3] Add failing tests in `tests/context/tokens.test.ts`: `estimateContextBreakdown({ history, memory, summary, message })` returns `summary` and `total` including it; `contextBreakdownSchema` requires `summary`
- [X] T026 [P] [US3] Add failing tests in `tests/http/server.test.ts`: with 16 prior messages and the fake, response `trace[0]` is the `summarize` event and `metrics.contextBreakdown.summary > 0`; the following turn has no `summarize` event; with a rejecting fake the status is 200, `trace[0].status === "failed"` and the answer is returned

### Implementation for User Story 3

- [X] T027 [US3] Extend `traceEventSchema` in `src/trace/trace.ts` with `z.object({ type: z.literal("summarize"), content: z.string(), status: z.enum(["ok", "failed"]), messages: z.number().int().nonnegative(), estimatedTokens: z.number().int().nonnegative().nullable() }).strict()`; ensure `sanitizeTraceEvent` and `formatTrace` handle it
- [X] T028 [US3] In `src/context/conversation-history.ts`, build the `summarize` event (success: `Summarized N older messages into ~T tokens.`; failure: `Summarization failed; previous summary kept: <redacted reason>`), wrap summarizer call + validation in try/catch, log failures with `console.error`, and keep previous summary/coverage on failure. Makes T024 pass
- [X] T029 [US3] In `src/context/tokens.ts`, add `summary` to `ContextSections`, `contextBreakdownSchema` (`summary: int≥0`) and `estimateContextBreakdown` (`total = history + memory + summary + message`); update existing breakdown tests in `tests/context/tokens.test.ts` and `tests/http/server.test.ts` to include `summary: 0`. Makes T025 pass
- [X] T030 [US3] In `src/http/server.ts`, prepend `prepared.event` (when not null) to `result.trace` in the response and pass `chatContext.sections` (now with `summary`) to `estimateContextBreakdown`. Makes T026 pass
- [X] T031 [US3] Run `npm run typecheck` and `npm test`

**Checkpoint**: All stories functional and observable.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T032 [P] Update `README.md` "Medição de contexto" section: 8-message recent window, persisted merged summary (~151 tokens) in `conversation_summaries`, refresh every 8 messages that leave the window, `summarize` trace event and `contextBreakdown.summary`
- [X] T033 [P] Update `specs/010-context-token-metrics/contracts/chat-metrics.md` with a note linking to `specs/011-history-summarization/contracts/chat-summarization.md` for the new `summary` breakdown field
- [X] T034 Review constitution compliance: pure `planHistory`/validation, Zod on summarizer output and DB rows, redaction before and after summarization, no test hitting a real model
- [X] T035 Final gate: `npm run typecheck` and `npm test` (only the pre-existing feature-009 failures may remain); optionally run quickstart.md §2 live with `TURNS=20 npm run conversa-longa`

---

## Dependencies & Execution Order

- **Setup (T001–T002)** → **Foundational (T003–T008)** → stories
- **US1 (Phase 3)**: depends on Foundational
- **US2 (Phase 4)**: depends on US1's service (T014)
- **US3 (Phase 5)**: depends on US1 (service and server wiring); independent of US2
- **Polish**: after the desired stories

### Within Each Story

- Tests first → pure logic → service → controller → gate
- US1: T013 → T014 → (T015 ∥ T016) → T017
- US3: T027 → T028 → T029 → T030

### Parallel Opportunities

- T001 ∥ T002; T004 ∥ T003
- US1 tests T009, T010 (same new file, separate blocks) ∥ T011 (different file); T015 ∥ T016
- US2 tests T019–T021 are separate test blocks
- US3 tests T024 ∥ T025 ∥ T026 (different files)
- T032 ∥ T033

## Parallel Example: User Story 1

```text
Task: "T011 [US1] composer tests in tests/http/compose-chat-prompt.test.ts"
Task: "T009 [US1] planHistory tests in tests/context/conversation-history.test.ts"
# after T014:
Task: "T015 [US1] LLM summarizer in src/context/llm-history-summarizer.ts"
Task: "T016 [US1] summary section in src/http/compose-chat-prompt.ts"
```

## Parallel Example: User Story 3

```text
Task: "T024 [US3] event tests in tests/context/conversation-history.test.ts"
Task: "T025 [US3] breakdown tests in tests/context/tokens.test.ts"
Task: "T026 [US3] server event tests in tests/http/server.test.ts"
```

## Implementation Strategy

### MVP First (User Story 1)

1. Setup + Foundational
2. US1 → validate with the fake summarizer: summary appears in the prompt at 16 prior messages
3. Stop and review

### Incremental Delivery

1. US1 → pruned history with summary (MVP)
2. US2 → merge, persistence across restart, batch-only refresh, concurrency safety
3. US3 → `summarize` trace event, failure visibility, breakdown `summary`
4. Polish → docs and final gate
