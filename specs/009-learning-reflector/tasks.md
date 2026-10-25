# Tasks: Learning Reflector

**Input**: Design documents from `/specs/009-learning-reflector/`

**Prerequisites**: `spec.md` (required), existing memory and reflection implementation in `src/memory/memory-store.ts` and `src/strategies/reflection.ts`, plus the repository conventions in `package.json`.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm the repository contract and align the feature with the existing strategy, memory, and validation boundaries.

- [ ] T001 Audit the existing reflection and memory contracts in `src/strategies/reflection.ts`, `src/memory/memory-store.ts`, and `src/domain/domain.ts` to confirm the learning-reflector integration points and validation rules.
- [ ] T002 [P] Define the structured reflection output contract for durable learning in `src/domain/domain.ts` or a feature-local validation module, covering `hasLearning` and `fact` with required trimming, non-empty, and safe-value checks.
- [ ] T003 [P] Review the current tool registration pattern in `src/tools/index.ts` and the strategy registry in `src/agentes/index.ts` to place the `forget_preference` tool and user-scoped learning hook without breaking the existing agent flow.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Add the shared safety and memory interfaces that every user story depends on before story implementation begins.

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel.

- [ ] T004 Implement a reusable learning-candidate validation helper in `src/domain/domain.ts` or a new `src/domain/learning.ts` module that rejects empty, ambiguous, and secret-bearing facts before any persistence.
- [ ] T005 Implement the durable-learning guardrail in `src/strategies/reflection.ts` so it evaluates only the latest user message, skips nil user identity, and emits a structured result equivalent to `withStructuredOutput({ hasLearning, fact })`.
- [ ] T006 [P] Add asynchronous post-response memory persistence logic in `src/strategies/reflection.ts` that calls the existing `memories.remember` behavior only when `hasLearning` is true and the fact passes the shared validation gate.
- [ ] T007 [P] Extend the memory store contract in `src/memory/memory-store.ts` and its validation path to ensure all stored facts remain user-scoped, non-empty, and deduplicated by the existing similarity rules.
- [ ] T008 Create the forget-tool contract and current-user resolution logic in `src/tools/index.ts` and the agent/tool boundary so a `forget_preference` request deletes only a single matching memory for the active user and otherwise reports no deletion or ambiguity.

---

## Phase 3: User Story 1 - Remember durable user context (Priority: P1) 🎯 MVP

**Goal**: Persist only durable, user-specific learning candidates after a successful response, while never blocking the response itself.

**Independent Test**: Submit a successful chat turn with a user identity and a durable preference; verify the response is returned without waiting for reflection and that the memory is written only for that same user.

### Tests for User Story 1

- [ ] T009 [P] [US1] Write a unit test in `tests/` for a valid durable preference that asserts `hasLearning` is true, `fact` is trimmed and non-empty, and the asynchronous memory path is invoked after the primary response succeeds.
- [ ] T010 [P] [US1] Write a unit test in `tests/` that proves no learning is triggered when the request has no user identity or when the latest message is transient or empty.
- [ ] T011 [P] [US1] Write a unit test in `tests/` that rejects malformed reflection output (e.g., `hasLearning` true with empty fact or `hasLearning` false with a populated fact) before memory mutation.

### Implementation for User Story 1

- [ ] T012 [US1] Implement the durable fact filter in `src/strategies/reflection.ts` so one-time requests, transient state, and non-user-scoped content become `hasLearning: false` without persisting anything.
- [ ] T013 [US1] Add the guarded asynchronous remember call in `src/strategies/reflection.ts` that keeps the response success path non-blocking and records operational failures through the app's error reporting instead of changing the delivered response.
- [ ] T014 [US1] Ensure the reflection validation path in `src/domain/domain.ts`/`src/strategies/reflection.ts` trims and checks the fact before `remember` is invoked, keeping the memory store version of `fact` safe and deduplicated.
- [ ] T015 [US1] Validate that all memory writes remain isolated to the current user identity by checking the user-scoped path in `src/memory/memory-store.ts` and the user identity passed from the chat request.

**Checkpoint**: At this point, User Story 1 should be fully functional and independently testable.

---

## Phase 4: User Story 2 - Avoid storing transient or sensitive content (Priority: P1)

**Goal**: Reject secrets and speculative or transient facts before any memory mutation while preserving useful durable preferences.

**Independent Test**: Send examples of a one-off request, temporary incident detail, credential, token, API key, and durable safe preference; verify only the durable safe preference passes to memory.

### Tests for User Story 2

- [ ] T016 [P] [US2] Write a unit test in `tests/` covering a transient request that should yield `hasLearning: false` and no memory write.
- [ ] T017 [P] [US2] Write a unit test in `tests/` covering password, access token, API key, and private key examples that must be rejected before persistence.
- [ ] T018 [P] [US2] Write a unit test in `tests/` covering a safe durable preference mixed with a secret, ensuring the candidate is rejected unless a clear, secret-free fact can be isolated.

### Implementation for User Story 2

- [ ] T019 [US2] Add conservative secret detection in the learning validation layer in `src/domain/domain.ts` or a feature-local validation module, rejecting known credential patterns before any fact is persisted.
- [ ] T020 [US2] Update the durable-learning decision step in `src/strategies/reflection.ts` to classify transient, temporary, or instruction-only content as non-learning even when it contains a sentence that might otherwise look like user context.
- [ ] T021 [US2] Guard the persistence path so a candidate with any unresolved safety uncertainty fails closed and never reaches `memories.remember`.
- [ ] T022 [US2] Add error logging or structured operational reporting for rejected/failed reflection candidates without changing a successful chat response.

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently.

---

## Phase 5: User Story 3 - Forget a learned preference (Priority: P2)

**Goal**: Let the user revoke a learned preference safely and only for the matching current-user memory.

**Independent Test**: Ask the assistant to forget one previously learned preference; verify the matching memory for the current user is removed, while ambiguous, missing, and other-user matches produce no destructive action.

### Tests for User Story 3

- [ ] T023 [P] [US3] Write a unit test in `tests/` for the exactly-one-match case that expects the matching memory to be deleted and the tool to report success.
- [ ] T024 [P] [US3] Write a unit test in `tests/` for no-match and ambiguous-match scenarios to assert no deletion and a clarification request.
- [ ] T025 [P] [US3] Write a unit test in `tests/` ensuring a memory belonging to another user is not disclosed or deleted by the current user request.

### Implementation for User Story 3

- [ ] T026 [US3] Add the `forget_preference` tool definition and schema in `src/tools/index.ts` or a dedicated tool file under `src/tools/` so it accepts the natural-language preference description and current user context.
- [ ] T027 [US3] Implement the user-bound recall-and-delete guard in `src/memory/memory-store.ts` or a service wrapper that resolves exactly one current-user memory and refuses ambiguous or multi-match requests.
- [ ] T028 [US3] Ensure the tool reports clear outcomes for the three states: single match (delete success), no match (no deletion), ambiguous match (no deletion + clarification request).
- [ ] T029 [US3] Confirm the forget action never reveals memory content or IDs for another user and always works inside the current-user isolation boundary.

**Checkpoint**: All user stories should now be independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final validation across the feature and regression checks for the repository's required quality gates.

- [ ] T030 [P] Review the cross-cutting validation and boundary checks in `src/domain/domain.ts`, `src/memory/memory-store.ts`, and `src/strategies/reflection.ts` to ensure malformed inputs are rejected before any memory mutation.
- [ ] T031 [P] Run the focused repository validation commands from `package.json`: `npm test` and `npm run typecheck`, and fix any regressions introduced by the learning-reflector changes.
- [ ] T032 [P] Update or add feature-facing documentation references in `README.md` or the feature-local docs to describe the durable-learning safety model and the conservative `forget_preference` behavior.
- [ ] T033 Run the quick validation scenarios defined in the feature spec to confirm the happy path, skip path, secret rejection, and forget-tool edge cases all pass.

---

## Dependencies & Execution Order

### Phase Dependencies

- Setup (Phase 1): No dependencies - can start immediately.
- Foundational (Phase 2): Depends on Setup completion and blocks all story work.
- User Story 1 (Phase 3): Depends on Foundational completion.
- User Story 2 (Phase 4): Depends on Foundational completion and can run in parallel with User Story 1 if needed.
- User Story 3 (Phase 5): Depends on Foundational completion and may run in parallel with earlier stories once the shared memory and validation contracts are stable.
- Polish (Phase 6): Depends on all desired story completion.

### Parallel Opportunities

- T002 and T003 can run together in Phase 1.
- T006 and T007 can run in parallel in the Foundational phase.
- The three user-story test tasks in each phase are intentionally parallelizable.
- The model/validation tasks within each story can be developed in parallel when the story owner is working in separate files.

---

## Parallel Example: User Story 1

```bash
# Test tasks can be written together
Task: "Write durable preference happy-path test in tests/"
Task: "Write no-user skip test in tests/"
Task: "Write malformed reflection-output reject test in tests/"

# Model and persistence tasks can proceed in parallel after the validation contract is in place
Task: "Implement durable fact filter in src/strategies/reflection.ts"
Task: "Validate memory user scoping in src/memory/memory-store.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 and Phase 2.
2. Complete Phase 3 for User Story 1.
3. Stop and validate the happy path, skip path, and malformed-output protection.
4. Only then continue to the secret and forget stories.

### Incremental Delivery

1. Land the durable-learning validation and async remember flow.
2. Add the conservative secret/transient rejection guard.
3. Add the safe forget tool and user-bound matching logic.
4. Finish with regression and repo validation.
