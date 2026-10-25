---

description: "Implementation tasks for OpsPilot Reasoning Core"
---

# Tasks: OpsPilot Reasoning Core

**Input**: Design documents from `specs/001-reasoning-core/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, and `quickstart.md`.

**Tests**: Tests are required by the feature specification for deterministic store/trace behavior and by the constitution for all new logic. Strategy and CLI tests use fakes; no unit test may require OpenRouter or MySQL.

**Organization**: Tasks are grouped by user story. All task lines use the required checklist form and include file paths.

## Phase 1: Setup

**Purpose**: Add the JSON seed command and ensure project configuration covers its source.

- [X] T001 Update `package.json` to add `"seed": "node --env-file-if-exists=.env --import tsx scripts/seed.ts"` while preserving the existing scripts and dependencies.
- [X] T002 Update `tsconfig.json` to include `scripts/**/*.ts` and keep `.env.example` limited to the OpenRouter model variables used by the prototype.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Define shared, validated result/trace contracts and explicit domain errors before implementing stories.

- [X] T003 [P] Add deterministic tests in `tests/trace/trace.test.ts` for each trace event kind, action tool/args, stable formatting order, and exclusion of secret values.
- [X] T004 Implement Zod trace-event and strategy-result schemas plus pure trace formatting in `src/trace/trace.ts`; include `thought`, `action`, `observation`, `plan`, `critique`, and `answer`, with `tool` and `args` required for actions.
- [X] T005 Define the shared `ReasoningStrategy`, run input/result, metrics, and injectable model-call counter types in `src/strategies/strategy.ts`, validating results with the schemas from `src/trace/trace.ts`.
- [X] T006 Define explicit configuration, validation, unknown-service, unknown-incident, and strategy-limit domain errors in `src/domain/errors.ts`.

**Checkpoint**: Shared contracts and error types are in place; store, strategy, and CLI stories can build against the same typed boundaries.

---

## Phase 3: User Story 1 - Compare reasoning strategies (Priority: P1)

**Goal**: Let an operator run selected strategies against the same question and inspect separate answers, traces, and metrics.

**Independent Test**: Run the arena's argument parser and runner with deterministic fake strategies; verify common input, selected ordering, isolated initial stores, printed event order, and metrics without network access.

### Tests for User Story 1

- [X] T007 [P] [US1] Add tests in `tests/arena/arena-cli.test.ts` for positional input, `--strategies`, `--max-iterations`, defaults, help, and invalid/duplicate/unknown options.
- [X] T008 [P] [US1] Add tests in `tests/arena/arena.test.ts` for strategy selection order, identical input, fresh store state per strategy, and output containing answer, ordered trace, LLM-call count, and latency.

### Implementation for User Story 1

- [X] T009 [US1] Implement pure Zod-backed arena argument parsing in `src/arena-cli.ts`, accepting `--strategies` and positive `--max-iterations`, defaulting to both strategies and eight iterations, and returning actionable errors for invalid input.
- [X] T010 [US1] Implement pure result formatting in `src/arena-cli.ts` using `src/trace/trace.ts`; format strategy groups in selection order with answer, ordered events, `llmCalls`, and `latencyMs`, excluding secrets.
- [X] T011 [US1] Implement arena orchestration in `src/arena.ts` to pass the same question and iteration limit to each selected strategy, provide each a fresh copy of the same seeded memory baseline, print every result, and return non-zero on input/configuration/run failure.
- [X] T012 [US1] Expose an import-safe CLI entry point in `src/arena.ts` that accepts an injected strategy registry and runner dependencies, so importing helpers in `tests/arena/arena.test.ts` never starts the command.

**Checkpoint**: The arena can be tested with fakes and, after User Story 3, runs either or both real strategies without sharing mutable store state.

---

## Phase 4: User Story 2 - Inspect and manage alert incidents (Priority: P1)

**Goal**: Provide deterministic alert and incident tools, shared seed fixtures, and a repeatable JSON seed command.

**Independent Test**: Run `node --import tsx --test tests/store/ops-store.test.ts tests/tools/list-alerts.test.ts tests/tools/open-incident.test.ts tests/tools/resolve-incident.test.ts tests/tools/index.test.ts`; verify the five-service/six-alert baseline, all alert filters, incident open/resolve transitions, validation, and explicit errors without network or MySQL.

### Tests for User Story 2

- [X] T013 [P] [US2] Add in-memory store tests in `tests/store/ops-store.test.ts` for fixture isolation, exactly five services, six alerts, three firing/three resolved, filtering, opening, resolving, idempotent resolution, and unknown references.
- [X] T014 [P] [US2] Add tool tests in `tests/tools/list-alerts.test.ts`, `tests/tools/open-incident.test.ts`, `tests/tools/resolve-incident.test.ts`, and `tests/tools/index.test.ts` for Zod input/output validation, all three public tool names, default alert status, serialized results, and explicit domain errors using an injected in-memory store.
- [X] T015 [P] [US2] Add deterministic Sequelize model-definition tests in `tests/db/models.test.ts` that inspect service/alert/incident fields and associations without connecting to MySQL.

### Implementation for User Story 2

- [X] T016 [US2] Define Zod schemas and TypeScript types for Service, Alert, Incident, severity, status, and tool outputs in `src/domain/domain.ts`; require non-empty IDs, names, titles, and service references and the exact enums from `specs/001-reasoning-core/data-model.md`.
- [X] T017 [US2] Define immutable canonical fixtures for five uniquely identified services and six varied alerts (exactly three `firing`, three `resolved`) with fixed timestamps in `src/store/seed-data.ts`.
- [X] T018 [US2] Implement an isolated, fixture-resettable in-memory `OpsStore` in `src/store/ops-store.ts` with deterministic alert ordering, status filtering, validated incident creation, and idempotent incident resolution.
- [X] T019 [US2] Implement pure incident/alert domain operations and typed unknown-service/unknown-incident failures in `src/domain/ops-service.ts`, depending on `src/store/ops-store.ts`.
- [X] T020 [US2] Implement Zod-backed `list_alerts`, `open_incidente`, and `resolve_incident` tools in `src/tools/list-alerts.ts`, `src/tools/open-incident.ts`, and `src/tools/resolve-incident.ts`, assembled by `createOpsTools` in `src/tools/index.ts`, delegating to `src/domain/ops-service.ts` and validating both inputs and returned records.
- [X] T021 [US2] Configure Sequelize/MySQL connection creation from `MYSQL_HOST`, optional `MYSQL_PORT` defaulting to 3306, `MYSQL_DATABASE`, `MYSQL_USER`, and `MYSQL_PASSWORD`, and validate missing settings without printing values in `src/db/sequelize.ts`.
- [X] T022 [US2] Define Sequelize 6 service, alert, and incident models with the data-model field constraints, primary keys, status/severity enums, and service associations in `src/db/models.ts`.
- [X] T023 [US2] Implement the standalone idempotent JSON seed in `scripts/seed.ts`; upsert canonical service/alert fixtures by stable IDs, preserve additional records, and report baseline counts.
**Checkpoint**: JSON-seeded in-memory tools and tests work without a database; `npm run seed` restores the five-service/six-alert baseline without duplicates.

---

## Phase 5: User Story 3 - Use bounded reasoning strategies (Priority: P2)

**Goal**: Implement OpenRouter-backed ReAct and Plan-and-Execute strategies with typed traces, full LLM-call accounting, and explicit finite limits.

**Independent Test**: Run `node --import tsx --test tests/llm/model.test.ts tests/strategies/react.test.ts tests/strategies/plan-and-execute.test.ts`; use injected fake models/tools to verify traces, counts, errors, and stopping conditions without network access.

### Tests for User Story 3

- [X] T024 [P] [US3] Add `tests/llm/model.test.ts` tests for `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, OpenRouter base URL, zero temperature, and actionable missing/blank configuration errors without making a request.
- [X] T025 [P] [US3] Add `tests/strategies/react.test.ts` tests with an injected fake agent runner and tools for complete ordered action/observation/answer traces, invocation counts including failures, max-iteration termination, and no network access.
- [X] T026 [P] [US3] Add `tests/strategies/plan-and-execute.test.ts` tests with fake planner/executor/replanner dependencies for structured plan validation, single-step execution, replanning after every step, no-work termination, the eight-action cap, and the shared LLM-call budget.

### Implementation for User Story 3

- [X] T027 [US3] Implement the single `ChatOpenAI` model factory in `src/llm/model.ts`, requiring non-blank `OPENROUTER_API_KEY` and `OPENROUTER_MODEL`, setting `configuration.baseURL` to `https://openrouter.ai/api/v1`, and setting temperature to zero.
- [X] T028 [US3] Implement sanitized message-to-event conversion in `src/trace/trace.ts`, mapping model/tool messages to typed events without exposing private chain-of-thought or environment secrets.
- [X] T029 [US3] Implement `reactStrategy` in `src/strategies/react.ts` using `createReactAgent` from `@langchain/langgraph/prebuilt`, `src/tools/index.ts`, injected model dependencies for tests, bounded model calls via callback accounting and graph recursion limit, and accumulated trace states on limit.
- [X] T030 [US3] Implement planner/replanner Zod structured-output schemas, plan state, and one-step executor/replan conditional routing in `src/strategies/plan-and-execute.ts`.
- [X] T031 [US3] Enforce the shared maximum LLM-invocation count (including failed calls) and eight-action ceiling in `src/strategies/plan-and-execute.ts`; return a validated result with explicit bounded-run answer, complete accumulated trace, and elapsed metrics when a limit is reached.
- [X] T032 [US3] Validate both real strategies against `specs/001-reasoning-core/contracts/reasoning-strategy.md` and arena wiring in `tests/arena/arena.test.ts` using fake dependencies, without OpenRouter or MySQL access.

**Checkpoint**: Both strategy runs stop within their model-call budget; Plan-and-Execute performs at most eight actions and the arena can select either or both.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Verify integration, seed behavior, documented examples, and quality gates.

- [X] T033 [P] Reconcile `.env.example` and `README.md` with the OpenRouter variables and JSON seed commands in `specs/001-reasoning-core/quickstart.md`, ensuring neither file contains real credentials.
- [X] T034 Run `npm test` and fix failures in the affected `tests/**/*.test.ts` files; confirm store, trace, CLI, and fake-strategy tests do not require network or MySQL.
- [X] T035 Run `npm run typecheck` and resolve TypeScript errors in `src/**/*.ts`, `tests/**/*.ts`, `scripts/**/*.ts`, and `tsconfig.json`.
- [X] T036 Run `npm run seed` to create/restore the JSON baseline in `data/ops-store.json`; verify five services and six alerts (three firing/three resolved), then run it repeatedly to confirm idempotence.
- [X] T037 Run the `specs/001-reasoning-core/quickstart.md` arena help and fake-backed validation scenarios, confirming invalid flags fail visibly and valid result formatting remains stable in `src/arena.ts` and `src/arena-cli.ts`.
- [X] T038 [US3] Extend `tests/strategies/plan-and-execute.test.ts` to verify each completed step/result pair is available to the replanner and that its adjust/continue/finish decision controls routing.
- [X] T039 [US3] Update `src/strategies/plan-and-execute.ts` to track done step/result pairs and apply explicit adjust/continue/finish replanner decisions with the eight-action ceiling.
- [X] T040 [US2] Add `src/store/ops-database.ts`, `src/db/json-seed.ts`, and `data/ops-store.json` so the validated JSON baseline seeds isolated in-memory stores and can be restored idempotently.
- [X] T041 [US2] Add `tests/db/json-seed.test.ts` for repeatable seeding, preservation of extra records, and memory-only tool mutations.
- [X] T042 Update `README.md` and `specs/001-reasoning-core/{spec,plan,research,data-model,quickstart}.md` plus related contracts to document JSON-backed seed data and Plan-and-Execute decision tracking.

**Storage note**: MySQL model definitions remain available for later use, but the active seed path and strategy stores use `data/ops-store.json` as requested. Tool mutations are scoped to the current in-memory store and are not written back to the shared baseline.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; complete before invoking the JSON seed.
- **Foundational (Phase 2)**: Depends on setup; blocks all user-story work.
- **User Story 1 (Phase 3)**: Depends on the shared strategy and trace contracts. Arena tests and parser/formatter can be developed with fake strategies.
- **User Story 2 (Phase 4)**: Depends on setup and shared validation/error contracts. Its in-memory tools are independently testable; MySQL persistence is an optional adapter for tool/arena use.
- **User Story 3 (Phase 5)**: Depends on the shared strategy/trace contracts and User Story 2 tools/store. Its models can be tested without external services.
- **Polish (Phase 6)**: Depends on all desired stories; execute `npm run seed` to validate the JSON baseline and repeatability.

### User Story Dependencies

- **User Story 1 (P1)**: Arena parsing, output, and execution are independently testable with injected fake strategies after Phase 2. Production registry wiring is deferred to the final integration task in User Story 3.
- **User Story 2 (P1)**: Can be implemented after Phase 2 and independently validated through the JSON-seeded in-memory adapter; it provides tools consumed by User Story 3.
- **User Story 3 (P2)**: Depends on the User Story 2 tools/store and Phase 2 contracts; can proceed alongside arena parser/format work after shared boundaries are stable.
- Final end-to-end arena operation requires User Stories 1, 2, and 3.

### Within Each User Story

- Write the explicitly requested tests before their implementations and verify the tests fail for the missing behavior.
- Keep each task focused on the listed files; do not combine unrelated story work.
- Complete JSON-backed in-memory operations before enabling the separate Sequelize/MySQL adapter; database access is not a prerequisite for unit tests.
- Run focused tests and `npm run typecheck` at story checkpoints.

### Parallel Opportunities

- Setup tasks T001 and T002 affect different files and may run in parallel.
- Foundational trace tests T003 can be authored separately from error definitions T006; implement trace schemas/formatting before running T003.
- US1 tests T007 and T008 touch separate files and can be authored in parallel; parsing/formatting tasks can proceed before real strategy integration.
- US2 tests T013-T015 use separate test files and can be authored in parallel; fixture, store, and database models are distinct files after contracts are fixed.
- US3 tests T025-T027 use separate files and can be authored in parallel; the model factory, ReAct, and Plan-and-Execute are distinct implementations after US2 tools are stable.
- Polish T034-T037 touch documentation, tests, and validation and can be performed independently once implementation is complete. JSON seeding requires no service credentials.

## Parallel Example: User Story 1

```text
Task T007: add CLI parser tests in tests/arena/arena-cli.test.ts
Task T008: add arena output/selection tests in tests/arena/arena.test.ts

After Phase 2, implement:
Task T009: argument parser in src/arena-cli.ts
Task T010: result formatter in src/arena-cli.ts (sequential with T009; same file)
```

## Implementation Strategy

### MVP First

The smallest independently demonstrable slice is the in-memory alert/incident
store and its deterministic tests (User Story 2), followed by one fake-backed
strategy in the arena. The operator-facing comparison flow (User Story 1) is
fully complete only after both real strategies in User Story 3 are wired.

### Incremental Delivery

1. Complete Setup and Foundational contracts.
2. Implement the JSON-seeded in-memory portion of User Story 2; test it without external services.
3. Implement arena parsing/output with fakes for User Story 1.
4. Implement User Story 3 with fake model/tool tests, then wire real strategies to the arena.
5. Implement and run the JSON seed, then complete all quickstart and quality checks.

### Parallel Team Strategy

After Phase 2, one contributor can implement arena parser/formatter tests while
another prepares the in-memory store tests. Keep the store/tool API stable before
starting strategy integration. Strategy and database model work can proceed in
parallel only after the shared domain schemas and fixtures are agreed.

## Notes

- `[P]` means separate files with no unfinished prerequisite; same-file edits are sequential.
- Story labels trace tasks to the user stories in `spec.md`.
- Every task includes a concrete path and a verifiable outcome.
- Sequelize/MySQL is retained as a future adapter; the active prototype seed and tests use JSON and in-memory state.
