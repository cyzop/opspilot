---

description: "Task list for Context Token Metrics"
---

# Tasks: Context Token Metrics

**Input**: Design documents from `/specs/010-context-token-metrics/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/chat-metrics.md, contracts/conversa-longa-cli.md, quickstart.md

**Tests**: Requested explicitly ("com testes", FR-011, constitution IV). Tests are written first in each phase and must fail before the implementation task that satisfies them.

**Organization**: Tasks are grouped by user story so each story can be implemented and verified independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 = real `promptTokens`, US2 = `contextBreakdown`, US3 = `conversa-longa.sh`
- Paths are relative to the `ops-pilot/` project root (single project: `src/`, `tests/`, `scripts/`)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the new module location and test location.

- [X] T001 Create empty module `src/context/tokens.ts` (ESM, `strict` TS, imports only `zod` and type-only `@langchain/core` imports) and empty test file `tests/context/tokens.test.ts` using `node:test` + `node:assert/strict`, matching existing test style in `tests/strategies/react.test.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Pure token primitives used by both US1 and US2. No story work starts before this phase is green.

**⚠️ CRITICAL**: Complete T002–T004 before any user story phase.

- [X] T002 Write failing tests for `estimateTokens` in `tests/context/tokens.test.ts`: `""` → `0`; `"abc"` → `1`; `"abcd"` → `1`; `"abcde"` → `2`; a 400-char string → `100`; non-ASCII text (e.g. `"ação🚨"`) is estimated by its JS `.length` (UTF-16 units) divided by 4, rounded up; result is always a non-negative integer
- [X] T003 Implement and export `estimateTokens(text: string): number` in `src/context/tokens.ts` as `Math.ceil(text.length / 4)` (rule from data-model.md: "`ceil(text.length / 4)`; `""` → 0"); pure, no I/O
- [X] T004 Run `npm run typecheck` and `npm test` and confirm green before starting user stories

**Checkpoint**: Estimation primitive available.

---

## Phase 3: User Story 1 - See the real prompt size of each chat turn (Priority: P1) 🎯 MVP

**Goal**: Every successful `/chat` response carries `metrics.promptTokens`: the sum of provider-reported input tokens over all model calls of the turn, or `null` when any call lacks usage.

**Independent Test**: Run a strategy whose model calls emit `handleLLMEnd` with scripted `usage_metadata.input_tokens`; assert the strategy result and the `/chat` response report the exact sum, and `null` when one call has no usage.

### Tests for User Story 1 (write first, must fail)

- [X] T005 [P] [US1] Add failing tests in `tests/context/tokens.test.ts` for `inputTokensFromLlmResult(output: unknown): number | null`: reads `generations[0][0].message.usage_metadata.input_tokens` (e.g. 120 → 120); sums across multiple generations in the same result; falls back to `llmOutput.tokenUsage.promptTokens` when the message has no `usage_metadata`; returns `null` for `undefined`, `{}`, `{ generations: [] }`, negative, non-integer or string token values
- [X] T006 [P] [US1] Add failing tests in `tests/context/tokens.test.ts` for `sumPromptTokens(values: readonly (number | null)[]): number | null`: `[]` → `null`; `[10, 20, 30]` → `60`; `[10, null, 30]` → `null`; `[0]` → `0`
- [X] T007 [P] [US1] Add failing tests in `tests/context/tokens.test.ts` for `createUsageRecorder()`: fresh recorder → `promptTokens()` is `null`; after `handler.handleLLMEnd(result)` twice with input tokens 100 and 50 → `150`; after one call with usage and one with no usage → `null`; two recorders never share state
- [X] T008 [P] [US1] Add failing test in `tests/strategies/react.test.ts`: an `agentRunner` that receives the new third argument `callbacks` and calls `callbacks[...].handleLLMEnd` (find the handler that has `handleLLMEnd`) twice with fake `LLMResult` objects carrying `usage_metadata.input_tokens` 300 and 450 produces `result.metrics.promptTokens === 750`; an existing-style runner that ignores callbacks produces `result.metrics.promptTokens === null`
- [X] T009 [P] [US1] Add failing test in `tests/strategies/plan-and-execute.test.ts`: custom `planner(question, callbacks)` and `replanner(state, callbacks)` that invoke `handleLLMEnd` on the provided callbacks with 200 and 80 input tokens yield `result.metrics.promptTokens === 280`; planners that ignore the second argument yield `null`
- [X] T010 [P] [US1] Add failing test in `tests/strategies/reflection.test.ts`: a fake base strategy returning `metrics.promptTokens: 500` and a custom critic `(review, onModelCall, callbacks)` that reports 120 input tokens through `callbacks` yields `promptTokens === 620` for one round; when the base strategy omits `promptTokens`, the result is `null`; with two regenerations the base and critic usages of every round are summed
- [X] T011 [P] [US1] Add failing tests in `tests/http/server.test.ts`: with a fake strategy returning `metrics: { llmCalls: 1, latencyMs: 5, promptTokens: 1234 }`, the `/chat` 200 response has `metrics.promptTokens === 1234`; with the existing fake (`tests/helpers/fake-reasoning-strategy.ts`, no `promptTokens`) the response has `metrics.promptTokens === null` (key present); existing `llmCalls`, `latencyMs`, `historyMessages` assertions stay unchanged

### Implementation for User Story 1

- [X] T012 [US1] Implement and export in `src/context/tokens.ts`: a Zod schema for provider usage (`input_tokens`/`promptTokens` = `z.number().int().nonnegative()`), `inputTokensFromLlmResult(output: unknown): number | null` (message `usage_metadata.input_tokens` first, then `llmOutput.tokenUsage.promptTokens`; `null` when missing or invalid — per data-model.md "null when missing or invalid (Zod-validated)"), `sumPromptTokens` (`[]` → `null`, any `null` → `null`, otherwise sum), and `createUsageRecorder(): { handler: { handleLLMEnd(output: unknown): void }; promptTokens(): number | null }`; record only numbers, never prompt or output content. Makes T005–T007 pass
- [X] T013 [US1] Extend `strategyResultSchema.metrics` in `src/trace/trace.ts` with `promptTokens: z.number().int().nonnegative().nullable().optional()` (keep `.strict()`; existing fakes without the field must still validate)
- [X] T014 [US1] In `src/strategies/react.ts`, create a `createUsageRecorder()` per `run()`, append `recorder.handler` to the existing per-run `callbacks` array passed to `agent.stream`, extend `ReactStrategyOptions.agentRunner` with an optional third parameter `callbacks: readonly object[]` and pass the same array, and return `metrics: { ...context.metrics(), promptTokens: recorder.promptTokens() }`. Makes T008 pass
- [X] T015 [US1] In `src/strategies/plan-and-execute.ts`, create a recorder per `run()`; change the `planner`/`replanner` option types to accept a second optional `callbacks` argument; default planner/replanner call `structuredModel.invoke(messages, { callbacks })`; graph nodes pass `[recorder.handler]`; return `promptTokens: recorder.promptTokens()` in metrics. Makes T009 pass
- [X] T016 [US1] In `src/strategies/reflection.ts`, create a recorder per `run()`; extend the `critic` option with an optional third `callbacks` argument and add `recorder.handler` beside the existing `handleChatModelStart` callback in the default critic; collect each round's `latest.metrics.promptTokens ?? null`; final `promptTokens = sumPromptTokens([...baseRoundTokens, recorder.promptTokens()])` (null if any is null). Makes T010 pass; keep `tests/strategies/reflection-metrics.test.ts` green
- [X] T017 [US1] In `src/http/server.ts`, extend `chatResponseSchema.metrics` with `promptTokens: z.number().int().nonnegative().nullable()` (required, nullable) and set `promptTokens: result.metrics.promptTokens ?? null` when building the response. Makes T011 pass
- [X] T018 [US1] Run `npm run typecheck` and `npm test`; fix any compile errors in callers of the changed option types (e.g. `src/agentes/index.ts`, `src/arena.ts`, `src/bench.ts`, `tests/helpers/*`) without changing existing assertions

**Checkpoint**: `/chat` returns real `promptTokens` (or explicit `null`). MVP deliverable.

---

## Phase 4: User Story 2 - Understand where the context comes from (Priority: P1)

**Goal**: Every successful `/chat` response carries `metrics.contextBreakdown` with chars/4 estimates of the exact history, memory and message sections sent to the model, plus their total.

**Independent Test**: Send a turn with known history, memory facts and message; assert each breakdown value equals `ceil(sectionText.length / 4)` of the rendered section and `total` is their sum.

### Tests for User Story 2 (write first, must fail)

- [X] T019 [P] [US2] Create `tests/http/compose-chat-prompt.test.ts` with failing tests for `composeChatContext(message, history, memoryFacts)`: `prompt` equals `composeChatPrompt(...)` for the same inputs (no-history, history-only, memory-only, both); with no history and no memory, `sections` is `{ history: "", memory: "", message: <bare message> }`; with both, `sections.memory` starts with `"Semantic memory (relevant facts):"`, `sections.history` starts with `"Conversation history (oldest first):"` and contains only the last 12 messages when 14 are given, `sections.message` starts with `"Current message:"`; `prompt === [memory, history, message].filter(Boolean).join("\n")`
- [X] T020 [P] [US2] Add failing tests in `tests/context/tokens.test.ts` for `estimateContextBreakdown({ history, memory, message })`: returns `{ method: "chars/4", history: estimateTokens(history), memory: estimateTokens(memory), message: estimateTokens(message), total: <sum> }`; empty sections yield `0`; output validates against exported `contextBreakdownSchema`
- [X] T021 [P] [US2] Add failing tests in `tests/http/server.test.ts`: first turn without `conversationId`/`userId` returns `metrics.contextBreakdown` with `method: "chars/4"`, `history: 0`, `memory: 0`, `message: Math.ceil(message.length / 4)`, `total === message`; a follow-up turn on the same conversation returns `history > 0` and `total === history + memory + message`; a turn with `userId` and a fake memory store returning facts returns `memory > 0`

### Implementation for User Story 2

- [X] T022 [US2] In `src/context/tokens.ts`, export `contextBreakdownSchema = z.object({ method: z.literal("chars/4"), history: int≥0, memory: int≥0, message: int≥0, total: int≥0 }).strict()` and pure `estimateContextBreakdown(sections: { history: string; memory: string; message: string })`. Makes T020 pass
- [X] T023 [US2] In `src/http/compose-chat-prompt.ts`, add exported `composeChatContext(message, history, memoryFacts = [])` returning `{ prompt, sections: { history, memory, message } }` built from the same rendered strings (history after the `MAX_HISTORY_MESSAGES` window); reimplement `composeChatPrompt` as `composeChatContext(...).prompt` so its output is byte-for-byte unchanged. Makes T019 pass
- [X] T024 [US2] In `src/http/server.ts`, call `composeChatContext` once, pass `context.prompt` to `selected.run`, compute `estimateContextBreakdown(context.sections)` and add `contextBreakdown` (validated by `contextBreakdownSchema`, required) to `chatResponseSchema.metrics` and to the response. Makes T021 pass
- [X] T025 [US2] Run `npm run typecheck` and `npm test`; confirm all pre-existing server tests still pass unchanged

**Checkpoint**: `/chat` reports real `promptTokens` and estimated `contextBreakdown` side by side.

---

## Phase 5: User Story 3 - Observe context growth across a long conversation (Priority: P2)

**Goal**: `scripts/conversa-longa.sh` drives a multi-turn conversation against a running server and prints `promptTokens` per turn, per contracts/conversa-longa-cli.md.

**Independent Test**: With `npm run dev` running, `TURNS=12 npm run conversa-longa` prints a header plus 12 turn lines in one conversation; stopping the server makes it exit 1; `TURNS=abc` exits 2.

### Implementation for User Story 3

- [X] T026 [US3] Create `scripts/conversa-longa.sh` (`#!/usr/bin/env bash`, `set -euo pipefail`): read `OPSPILOT_URL` (default `http://localhost:3000`), `TURNS` (default `10`; must match `^[1-9][0-9]*$`, else print usage to stderr and exit 2), `STRATEGY` (default `react`); define a fixed array of at least 8 operational questions in pt-BR (alerts, incidents, runbooks, provider status), cycled with modulo; print a header with URL, strategy and turns; never read `.env`
- [X] T027 [US3] In `scripts/conversa-longa.sh`, for each turn build the JSON body with `node -e` (`{ message, strategy }` on turn 1, plus `conversationId` afterwards), POST with `curl -sS --fail-with-body -H "Content-Type: application/json" "$OPSPILOT_URL/chat"`; on curl failure print the body/error to stderr and exit 1; parse `conversationId` and `metrics` with `node -e`, exiting 1 if they are missing; print `turno %2d  promptTokens=%5s  estimado(history=… memory=… message=… total=…)` using `indisponível` when `promptTokens` is `null`
- [X] T028 [US3] Add `"conversa-longa": "bash scripts/conversa-longa.sh"` to `scripts` in `package.json`
- [X] T029 [US3] Manually validate per quickstart.md §3: run `bash -n scripts/conversa-longa.sh`; with the server stopped, confirm exit status 1; with `TURNS=abc`, confirm exit status 2; with a running server (if OpenRouter credentials are configured), confirm one line per turn and a flattening `history` estimate after turn 7

**Checkpoint**: All three stories functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T030 [P] Document the new metrics (`promptTokens`, `contextBreakdown`) and `npm run conversa-longa` in `README.md`, linking `specs/010-context-token-metrics/contracts/chat-metrics.md`
- [X] T031 Review `src/context/tokens.ts` and strategy changes for constitution compliance: pure functions, Zod at the usage boundary, no prompt/response text captured by the recorder, no secrets logged
- [X] T032 Final gate: run `npm run typecheck` and `npm test`; both must be green

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)** → **Foundational (Phase 2)** → user stories
- **US1 (Phase 3)**: depends on Phase 2
- **US2 (Phase 4)**: depends on Phase 2 only; independent of US1 (both edit `src/http/server.ts` and `tests/http/server.test.ts`, so run them sequentially or merge carefully)
- **US3 (Phase 5)**: depends on US1 (prints `promptTokens`); uses US2's breakdown if present, and must tolerate its absence only during development
- **Polish (Phase 6)**: after the desired stories

### Within Each Story

- Tests first, failing → implementation → typecheck/test gate
- US1: T012 (tokens) → T013 (schema) → T014/T015/T016 (strategies) → T017 (server)
- US2: T022 (tokens) → T023 (composer) → T024 (server)

### Parallel Opportunities

- T005, T006, T007 edit the same file but separate `test` blocks; T008, T009, T010, T011 are in different files and fully parallel
- T014, T015, T016 touch different strategy files and can run in parallel after T012–T013
- T019, T020, T021 are in different files and parallel
- T030 can run alongside T031

## Parallel Example: User Story 1

```text
# After T012 and T013:
Task: "T014 [US1] usage recorder in src/strategies/react.ts"
Task: "T015 [US1] usage recorder in src/strategies/plan-and-execute.ts"
Task: "T016 [US1] usage recorder in src/strategies/reflection.ts"
```

## Parallel Example: User Story 2

```text
Task: "T019 [US2] tests in tests/http/compose-chat-prompt.test.ts"
Task: "T020 [US2] tests in tests/context/tokens.test.ts"
Task: "T021 [US2] tests in tests/http/server.test.ts"
```

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 + Phase 2
2. Phase 3 (US1) → validate: `/chat` returns real `promptTokens` or `null`
3. Stop and review

### Incremental Delivery

1. US1 → real totals per turn (MVP)
2. US2 → estimated breakdown beside the real total
3. US3 → long-conversation script showing growth and plateau
4. Polish → docs and final gates
