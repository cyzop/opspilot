# Implementation Plan: History Summarization

**Branch**: `011-history-summarization` | **Date**: 2026-10-19 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/011-history-summarization/spec.md`

## Summary

Prune chat history: keep the 8 most recent messages verbatim, and condense older messages
into one persisted, merged summary (~151 tokens) per conversation, stored in a new SQLite
table `conversation_summaries`. A pure `planHistory` decides, from the messages newer than
the summary's coverage cursor, which are recent, which are pending and whether a batch of
≥ 8 pending messages must be summarized. A service `prepareConversationHistory` runs the
(injectable) summarizer only on those turns, validates and persists the merged result with a
conditional upsert, and returns a `summarize` trace event. The chat controller adds the
summary as a prompt section, prepends the event to the trace and reports
`contextBreakdown.summary`. Tests use a deterministic fake summarizer. See
[research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript ESM (`strict: true`) on Node.js 22 LTS

**Primary Dependencies**: `node:sqlite` (`DatabaseSync`), Zod 4, Express 5, `@langchain/core` messages + existing `createModel()` (OpenRouter) for the default summarizer

**Storage**: SQLite file from `OPSPILOT_DB` (default `./data/opspilot.db`), new table `conversation_summaries`; `:memory:` in tests

**Testing**: `node:test` via `tsx`; fake `HistorySummarizer` in `tests/helpers/fake-history-summarizer.ts`

**Target Platform**: Local Node.js HTTP server

**Project Type**: Single-project web service

**Performance Goals**: Zero extra model calls on non-threshold turns; one extra call per batch of 8 messages leaving the window

**Constraints**: Summary ≤ 302 estimated tokens (target 151); history bounded to 8–15 verbatim messages + summary; failures never fail the turn; no secrets sent to or stored by the summarizer

**Scale/Scope**: 1 new table, 2 new modules, store/composer/server/trace changes, ~5 test files touched

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment | Status |
|-----------|------------|--------|
| I. MVC e efeitos controlados | Model: `ConversationStore` + table; Service: `prepareConversationHistory` orchestrates I/O; pure logic in `planHistory`, summary validation and prompt composition; Controller: `server.ts` only wires and returns. | PASS |
| II. Contratos Zod | `conversationSummarySchema` for rows, `summaryTextSchema` for summarizer output (untrusted model data), extended `traceEventSchema` and `chatResponseSchema` validated at the HTTP edge. | PASS |
| III. Erros explícitos | Summarization failure reported as `summarize` event with `status: "failed"` and logged; unknown conversations still raise `UnknownConversationError`; no fabricated summaries. | PASS |
| IV. Testes | Fake summarizer; tests for planner, service, store, composer, server; typecheck/test kept green (pre-existing 009 failures noted separately). | PASS |
| V. Segurança / Spec Kit | Redaction before and after summarization via `sanitizeTraceText`; SQLite via `node:sqlite` and `OPSPILOT_DB`; no `.env` access. | PASS |

Post-design re-check: all PASS; no deviations to justify.

## Project Structure

### Documentation (this feature)

```text
specs/011-history-summarization/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/chat-summarization.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── context/
│   ├── tokens.ts                    # contextBreakdown gains `summary`
│   ├── conversation-history.ts      # NEW: constants, planHistory (pure), summaryTextSchema,
│   │                                #      HistorySummarizer type, prepareConversationHistory (service)
│   └── llm-history-summarizer.ts    # NEW: createLlmHistorySummarizer (default, OpenRouter)
├── domain/domain.ts                 # conversationSummarySchema + type
├── store/
│   ├── conversation-store.ts        # interface: messagesAfter, getSummary, saveSummary
│   └── sqlite-conversation-store.ts # conversation_summaries table + methods
├── http/
│   ├── compose-chat-prompt.ts       # summary section; RECENT_WINDOW replaces MAX_HISTORY (12 → 8)
│   └── server.ts                    # summarizer option, prepare history, prepend event, breakdown
└── trace/trace.ts                   # `summarize` trace event

tests/
├── helpers/fake-history-summarizer.ts   # NEW
├── context/conversation-history.test.ts # NEW
├── context/tokens.test.ts               # breakdown summary
├── store/sqlite-conversation-store.test.ts
├── http/compose-chat-prompt.test.ts
└── http/server.test.ts                  # new tests + update 12-message expectations
```

**Structure Decision**: Single project; summarization logic lives in `src/context/` next to
the token module from feature 010, persistence stays in the existing conversation store.

## Design Notes

1. **Turn flow in `/chat`** (inside the timed operation):
   `summary = store.getSummary(id)` → `unsummarized = store.messagesAfter(id, summary?.coveredUntilMessageId ?? 0)`
   → `plan = planHistory(unsummarized)` → if `plan.batch.length`: redact → `summarizer({ previousSummary, messages, targetTokens: 151 })`
   → redact + `summaryTextSchema` → `store.saveSummary({... coveredUntilMessageId: last batch id, coveredMessageCount: prev + batch.length })`
   → context = `{ summary, messages: success ? recent : pending + recent }`.
2. **Concurrency**: `saveSummary` conditional upsert (`WHERE excluded.covered_until_message_id > current`); if it returns `false`, re-read the stored summary and use it.
3. **Behavior change**: recent window 12 → 8. Existing server tests that assume 12 are updated; tests with ≥ 16 prior messages inject the fake summarizer.
4. **Default summarizer** is created lazily so missing OpenRouter config shows up as a failed `summarize` event, not a boot error.

## Complexity Tracking

No constitution violations to justify.
