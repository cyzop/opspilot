---

description: "Task list for Context Budget Builder (revised to the user's reference sketch)"
---

# Tasks: Context Budget Builder

**Input**: Design documents from `/specs/012-context-budget-builder/` — revised at implementation: shared `SYSTEM_PROMPT` (cut `never`), summary cut `never`, order system → summary → history → memories → message, budget keys `system|summary|history|memories`.

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/context-budget.md, quickstart.md

**Tests**: Requested ("Teste: tetos baixos cortam na ordem certa", FR-013). Tests first; they must fail before the implementation.

## Format: `[ID] [P?] [Story] Description`

---

## Phase 1: Setup

- [X] T001 Create `src/context/context-builder.ts` with `SYSTEM_PROMPT` (pt-BR OpsPilot on-call instruction), `contextBudgetSchema = z.object({ system, summary, history, memories: int≥0 }).strict()`, `DEFAULT_CONTEXT_BUDGET = { system: 400, summary: 200, history: 1200, memories: 300 }`, `UNLIMITED_CONTEXT_BUDGET`, `SectionCut = "never" | "oldest-first" | "lowest-score-first"`, `BuildContextInput` type; create `tests/context/context-builder.test.ts`

## Phase 2: Foundational

- [X] T002 Add `sectionReportSchema = z.object({ budget: int≥0, cut: z.enum([...]), keptTokens: int≥0, droppedItems: int≥0, droppedTokens: int≥0, overBudget: z.boolean() }).strict()` and `contextBudgetReportSchema = z.object({ system, summary, history, memories }).strict()` in `src/context/context-builder.ts`; add `system` to `ContextSections`, `contextBreakdownSchema` and `estimateContextBreakdown` in `src/context/tokens.ts` (`total = system + history + memory + summary + message`); update existing breakdown expectations in `tests/context/tokens.test.ts` and `tests/http/server.test.ts` with `system`
- [X] T003 Run `npm run typecheck`

---

## Phase 3: User Story 1 - Every strategy receives the built context (Priority: P1) 🎯 MVP

**Independent Test**: `buildContext` renders system → summary → history → memories → message with nothing cut under `UNLIMITED_CONTEXT_BUDGET`; the message and system prompt survive any budget; chat, reflection-wrapped, arena and bench strategies receive the built prompt.

- [X] T004 [P] [US1] Failing tests in `tests/context/context-builder.test.ts`: section order and exact rendering with all inputs; message-only input renders `System instructions:\n<SYSTEM_PROMPT>\nCurrent message:\nUser: <msg>`; with budgets all `0` the system and message are still present and history/memories omitted; `sections` match the rendered parts
- [X] T005 [P] [US1] Failing tests in `tests/http/server.test.ts`: the fake strategy input starts with `System instructions:` and ends with `Current message:\nUser: <msg>`; a `withReflection`-wrapped fake base receives the same prompt
- [X] T006 [US1] Implement `section(name, items, { budget, cut })`, `fitToBudget(section)` (initially: `never` keeps all; others keep all unless budget 0), `assemble(fitted, message)` and `buildContext(input)` in `src/context/context-builder.ts` (pure, no I/O). Makes T004 pass
- [X] T007 [US1] Reimplement `composeChatContext`/`composeChatPrompt` in `src/http/compose-chat-prompt.ts` as wrappers over `buildContext` with `UNLIMITED_CONTEXT_BUDGET`; update `tests/http/compose-chat-prompt.test.ts` to the new order and system section
- [X] T008 [US1] In `src/http/server.ts`, add `contextBudget?: ContextBudget`, build with `buildContext({ message, history: history.messages, summary: history.summary, memories: memoryResults.map(({ memory, score }) => ({ fact: memory.fact, score })), budget })`, feed `built.sections` to the breakdown; update existing exact-prompt assertions in `tests/http/server.test.ts` to the new format. Makes T005 pass
- [X] T009 [P] [US1] In `src/arena.ts` and `src/bench.ts`, pass `buildContext({ message: input, budget }).prompt` to `strategy.run`; update fakes in `tests/bench/bench.test.ts` (and arena tests if needed) to match on the scenario text contained in the input
- [X] T010 [US1] Run `npm run typecheck` and `npm test`

---

## Phase 4: User Story 2 - Cut order under low ceilings (Priority: P1)

**Independent Test**: Low ceilings drop the oldest messages and the lowest-score facts; system and summary are never cut and flagged `overBudget`.

- [X] T011 [P] [US2] Failing history tests: 6 messages, budget fitting header + 2 → keeps the 2 newest in order, `droppedItems: 4`, `keptTokens <= budget`; newest message alone over budget → history omitted
- [X] T012 [P] [US2] Failing memory tests: scores `[0.9, 0.5, 0.8, 0.2]`, budget fitting header + 2 → keeps 0.9 and 0.8 (score order), drops 0.5 and 0.2; ties keep earlier-recalled; budget below header + first fact → omitted
- [X] T013 [P] [US2] Failing `never` tests: summary and system larger than their budgets → kept whole, `overBudget: true`, `droppedItems: 0`
- [X] T014 [P] [US2] Failing combined test "tetos baixos cortam na ordem certa": all sections over low ceilings → history oldest-first, memories lowest-score-first, system/summary/message intact, order preserved
- [X] T015 [US2] Implement `fitToBudget` rules in `src/context/context-builder.ts`: `oldest-first` (iterate newest → oldest, keep while rendered ≤ budget, stop at first misfit), `lowest-score-first` (stable sort by score desc, keep while rendered ≤ budget, stop at first misfit), `never` (keep all, set `overBudget`); fill reports. Makes T011–T014 pass; run `npm test`

---

## Phase 5: User Story 3 - Configurable and visible (Priority: P2)

- [X] T016 [P] [US3] Failing tests for `loadContextBudget(env)`: `{}` → defaults; overrides for `CONTEXT_BUDGET_HISTORY="500"`, `CONTEXT_BUDGET_SUMMARY="0"`; `"-1"`, `"abc"`, `"1.5"`, `""` throw `ConfigurationError` naming the variable
- [X] T017 [P] [US3] Failing tests in `tests/http/server.test.ts`: `metrics.contextBudget` with the four section reports; with `contextBudget.history: 40` and 16 prior messages (fake summarizer) → `history.droppedItems > 0` and `contextBreakdown.history <= 40`; `createChatServer()` with `process.env.CONTEXT_BUDGET_MEMORIES = "x"` throws `ConfigurationError`
- [X] T018 [US3] Implement `loadContextBudget(env = process.env)`; in `src/http/server.ts` resolve `options.contextBudget ?? loadContextBudget()` at construction, add `contextBudget: contextBudgetReportSchema` to `chatResponseSchema.metrics` and return `built.report`; use `loadContextBudget()` in arena/bench. Makes T016–T017 pass

---

## Phase 6: Polish

- [X] T019 [P] README "Orçamento de contexto" section (variables, defaults, cut rules, system prompt, `metrics.contextBudget`)
- [X] T020 [P] Note in `specs/011-history-summarization/contracts/chat-summarization.md` about the new order and budgets (link to 012 contract)
- [X] T021 Constitution review (pure builder, env only in `loadContextBudget`, Zod on env/report, explicit `ConfigurationError`)
- [X] T022 Final gate: `npm run typecheck`, `npm test` (only pre-existing feature-009 failures may remain); `CONTEXT_BUDGET_HISTORY=abc` blocks server construction

## Dependencies

Setup → Foundational → US1 → US2 → US3 → Polish. Tasks touching `src/context/context-builder.ts` run sequentially; [P] test tasks are in separate blocks/files.
