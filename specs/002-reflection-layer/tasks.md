---

description: "Implementation tasks for OpsPilot Reflection Layer"

---

# Tasks: OpsPilot Reflection Layer

**Input**: Design documents from `specs/002-reflection-layer/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, and `quickstart.md`.

**Tests**: Tests are required by the OpsPilot constitution for every new behavior. Reflection, critic, and arena tests use injected fakes and do not call OpenRouter.

**Organization**: Tasks are grouped by user story in priority order and follow the checklist format.

## Phase 1: Setup

**Purpose**: No project setup changes are required; the existing TypeScript ESM configuration, dependencies, and Node test runner already cover this feature.

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: No shared infrastructure changes are required before the independently testable stories; the decorator and arena use existing strategy, trace, model, and CLI contracts.

## Phase 3: User Story 1 - Review and improve an operational answer (Priority: P1)

**Goal**: Decorate an existing reasoning strategy with structured evidence review, feedback-driven regeneration, and bounded retries.

**Independent Test**: Use deterministic strategy and critic fakes to verify initial approval, rejection and regeneration with feedback, default and explicit retry limits, trace preservation, invalid output, failure propagation, and no network access.

### Tests for User Story 1

- [X] T001 [P] [US1] Add fake-backed tests in `tests/strategies/reflection.test.ts` for immediate approval, preservation of base events, critique ordering, and zero-regeneration behavior when `maxReflection` is zero.
- [X] T002 [US1] Extend `tests/strategies/reflection.test.ts` to verify rejected feedback is included with the original question and safe observations on the same wrapped strategy instance, each new candidate is reviewed, and default `maxReflection` allows at most two regenerations.
- [X] T003 [US1] Extend `tests/strategies/reflection.test.ts` to verify non-approved final results at the retry limit, invalid structured critic output, empty rejection feedback, and base/critic/regeneration errors are reported without success-shaped fallback.

### Implementation for User Story 1

- [X] T004 [US1] Implement the validated critic result schema, `withReflection(strategy, opts)` decorator, retry loop, feedback context construction, ordered sanitized `critique` events, and returned result validation in `src/strategies/reflection.ts`.
- [X] T005 [US1] Implement the production structured critic in `src/strategies/reflection.ts` using `opts.model` or the shared OpenRouter factory; sanitize the operator question, answer, observations, and feedback before every model prompt and count actual critic model starts through LangChain callbacks.

**Checkpoint**: A decorated strategy reviews each candidate, regenerates only rejected candidates with feedback, stops on approval or retry exhaustion, preserves trace evidence, and propagates failures.

## Phase 4: User Story 2 - Use reflection with either reasoning strategy (Priority: P1)

**Goal**: Allow operators to select reflected ReAct and Plan-and-Execute strategies in the arena without changing existing unreflected selector behavior.

**Independent Test**: Run arena parsing and orchestration with fake strategy factories; verify both reflection selectors wrap the correct base strategy, receive configured limits and isolated stores, and invalid options fail visibly.

### Tests for User Story 2

- [X] T006 [P] [US2] Add parser tests in `tests/arena/arena-cli.test.ts` for `reflect:react`, `reflect:plan-and-execute`, `--max-reflection` defaulting to 2, explicit zero, and rejection of negative, fractional, unsafe, unknown, and duplicate values.
- [X] T007 [P] [US2] Add arena orchestration tests in `tests/arena/arena.test.ts` verifying each reflected selector decorates its matching base strategy, passes the configured retry limit, and preserves independent stores and output formatting.

### Implementation for User Story 2

- [X] T008 [US2] Extend `src/arena-cli.ts` strategy validation and parsing to accept `reflect:react` and `reflect:plan-and-execute`, parse `--max-reflection` as a non-negative safe integer defaulting to 2, and document the option in `ARENA_HELP`.
- [X] T009 [US2] Extend `src/arena.ts` strategy construction to create the selected base strategy and wrap it with `withReflection` only for reflected selector names, passing the parsed retry limit and preserving existing unreflected behavior.

**Checkpoint**: The arena runs either reflected strategy under the requested retry bound and continues to accept existing strategy names unchanged.

## Phase 5: User Story 3 - Inspect reflection outcomes and costs (Priority: P2)

**Goal**: Make critic outcomes, retry exhaustion, and total reflection model cost inspectable and accurately measured.

**Independent Test**: Use fake base results, critic decisions, model-start callbacks, and a controlled clock to compare exact expected trace order, review count, regeneration count, LLM calls, and total latency.

### Tests for User Story 3

- [X] T010 [P] [US3] Add deterministic metric and trace tests in `tests/strategies/reflection-metrics.test.ts` verifying total LLM calls equal all base-run calls plus actual critic model starts, latency covers the full decorated run, each review adds one critique event, and retry exhaustion marks the last critique unapproved.

### Implementation for User Story 3

- [X] T011 [US3] Refine `src/strategies/reflection.ts` metric aggregation and final critique content to report all base and critic model calls, full-run latency, and explicit approval or unapproved retry-limit status without exposing private reasoning or secrets.
- [X] T012 [US3] Reconcile `specs/002-reflection-layer/contracts/reflection-strategy.md` and `specs/002-reflection-layer/data-model.md` with the implemented critique event, explicit shared model injection, input redaction, aggregated call counts, and retry-exhaustion behavior.

**Checkpoint**: Arena output includes the full chronological base/critique trace and correct total `llmCalls` and `latencyMs` for approved and exhausted runs.

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Document runnable usage and verify the complete feature.

- [X] T013 [P] Update `specs/002-reflection-layer/quickstart.md` and `specs/002-reflection-layer/contracts/arena.md` with verified reflected arena commands, retry option behavior, and expected results.
- [X] T014 Run `npm test` and resolve any regressions in `tests/strategies/reflection.test.ts`, `tests/strategies/reflection-metrics.test.ts`, `tests/arena/arena-cli.test.ts`, and `tests/arena/arena.test.ts`.
- [X] T015 Run `npm run typecheck` and fix TypeScript errors in `src/strategies/reflection.ts`, `src/arena-cli.ts`, `src/arena.ts`, and affected tests.
- [X] T016 Run the deterministic fake-backed scenarios from `specs/002-reflection-layer/quickstart.md` and confirm `npm run arena -- --help` documents the reflected selectors and `--max-reflection` in `src/arena-cli.ts`.

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No setup tasks; existing project configuration is sufficient.
- **Foundational (Phase 2)**: No new foundational tasks; existing contracts and utilities are prerequisites already present.
- **User Story 1 (Phase 3)**: Can be implemented against the existing `ReasoningStrategy` and `StrategyResult` contracts.
- **User Story 2 (Phase 4)**: Depends on the `withReflection` decorator from User Story 1.
- **User Story 3 (Phase 5)**: Depends on the reflection lifecycle from User Story 1; its metric contract is consumed by arena output from User Story 2.
- **Polish (Phase 6)**: Depends on all three user stories.

### User Story Dependencies

- **User Story 1 (P1)**: Independent decorator and evidence-review behavior; no arena changes required.
- **User Story 2 (P1)**: Depends on User Story 1 to wrap either existing strategy in the arena.
- **User Story 3 (P2)**: Depends on User Story 1; can be tested independently of live arena/model calls.
- Final end-to-end arena verification depends on User Stories 1, 2, and 3.

### Parallel Opportunities

- T001 can be authored before decorator implementation. T006 and T007 touch separate test files and can be authored in parallel after the strategy selector contract is fixed.
- T010 uses a separate test file from T001-T003 and can be written in parallel with arena parser tests; it depends on the public decorator behavior, not on a live model.
- T013 documentation updates can proceed after contract decisions are stable; final T014-T016 validation runs after implementation is complete.
- Tasks that edit the same file (`reflection.ts`, `arena-cli.ts`, `arena.ts`, or a test file) must run sequentially.

## Parallel Example: User Story 2

```text
Task T006: add reflected selector and max-reflection parser tests in tests/arena/arena-cli.test.ts
Task T007: add reflected strategy wiring tests in tests/arena/arena.test.ts

After both tests are defined:
Task T008: implement argument validation and help in src/arena-cli.ts
Task T009: wire reflected strategy factories in src/arena.ts
```

## Implementation Strategy

### MVP First

Implement User Story 1 first: a fake-backed decorator that can approve an answer
or reject/regenerate it with feedback under a finite retry limit. This delivers
reviewed answers independently of arena integration.

### Incremental Delivery

1. Implement and test the reflection decorator against fake strategies and critics.
2. Add reflected selectors and retry-limit parsing/wiring to the arena.
3. Verify trace ordering, privacy, call counts, and latency with deterministic fakes.
4. Update quickstart/contracts and run full tests and typecheck.
