---
description: "Implementation tasks for OpsPilot HTTP Chat Registry"
---

# Tasks: OpsPilot HTTP Chat Registry

**Input**: Design documents from `specs/003-http-chat-registry/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, and `contracts/chat-http.md`.

**Tests**: Deterministic integration tests are required for the HTTP boundary and strategy registry; they must use fake strategies and no external network access.

**Organization**: Tasks are grouped by user story in priority order and follow the checklist format.

## Phase 1: Setup

**Purpose**: Prepare the minimal file structure needed for the HTTP boundary, registry, and integration tests.

- [ ] T001 [P] Create the HTTP and agent directories for `src/http/`, `src/agentes/`, `tests/http/`, and `tests/agents/` to match the implementation plan
- [ ] T002 [P] Confirm the existing strategy contracts in `src/strategies/reflection.ts`, `src/strategies/strategy.ts`, and related strategy files before implementing the HTTP route

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Establish the request validation and strategy selection foundation before user story work can begin.

- [ ] T003 Create the Zod request schema and shared validation helpers in `src/http/chat-schema.ts` for `message` (required, non-empty), optional `strategy`, and optional `reflect`
- [ ] T004 [P] Implement the strategy registry in `src/agentes/index.ts` with default `react` selection, supported names, and explicit unknown-strategy rejection
- [ ] T005 [P] Add the HTTP request handler in `src/http/server.ts` to parse JSON, validate the body, call the registry, and map success/error responses
- [ ] T006 Implement the 180-second time-budget wrapper in `src/http/server.ts` so requests exceeding the limit produce HTTP 504 without hidden fallback behavior

**Checkpoint**: The request boundary, registry, and timeout behavior are in place before the user story implementations proceed.

---

## Phase 3: User Story 1 - Submit a chat request and receive a validated answer (Priority: P1) 🎯 MVP

**Goal**: Deliver the default `/chat` flow for valid requests and enforce HTTP 400 validation errors.

**Independent Test**: POST a valid request with a deterministic fake strategy and confirm HTTP 200 with `answer`, `trace`, and `metrics`; POST invalid JSON or missing `message` and confirm HTTP 400 with Zod issues.

### Tests for User Story 1

- [ ] T007 [P] [US1] Add successful default-request integration tests in `tests/http/server.test.ts` for `POST /chat` with `message` and default `react`
- [ ] T008 [P] [US1] Add invalid-body integration tests in `tests/http/server.test.ts` to assert `400` and returned Zod issues for missing or malformed input

### Implementation for User Story 1

- [ ] T009 [US1] Implement the success path in `src/http/server.ts` so a valid request returns `200` with `answer`, `trace`, and `metrics` following the existing strategy contract
- [ ] T010 [US1] Add request-level error handling in `src/http/server.ts` to translate validation failures into `400` responses without executing the strategy

**Checkpoint**: User Story 1 is independently testable and returns the expected response contract for valid and invalid requests.

---

## Phase 4: User Story 2 - Choose the correct strategy and optional reflection path (Priority: P1)

**Goal**: Resolve supported strategies by name and apply the reflection decorator only when `reflect` is enabled.

**Independent Test**: Resolve `react`, `plan-and-execute`, and reflected variants through the registry and verify the correct strategy instance is selected and wrapped without altering the public result schema.

### Tests for User Story 2

- [ ] T011 [P] [US2] Add strategy registry tests in `tests/agents/registry.test.ts` covering `react`, `plan-and-execute`, default behavior, and `reflect: true`
- [ ] T012 [P] [US2] Add endpoint tests in `tests/http/server.test.ts` for supported strategies and reflected selection through the HTTP request body

### Implementation for User Story 2

- [ ] T013 [US2] Implement registry resolution in `src/agentes/index.ts` to map strategy names to the correct strategy instances and reject unsupported values with `422`
- [ ] T014 [US2] Implement the reflection opt-in in `src/agentes/index.ts` so `reflect` wraps the selected strategy with `withReflection(...)` while preserving the default unreflected flow
- [ ] T015 [US2] Wire the request body `strategy` and `reflect` values into `src/http/server.ts` so the route delegates to the registry and returns the reflected result when requested

**Checkpoint**: Both supported strategies and the reflected path are available through the public HTTP contract.

---

## Phase 5: User Story 3 - Handle operational failures and time limits safely (Priority: P2)

**Goal**: Ensure the HTTP layer reports unsupported strategies and timeout conditions explicitly and safely.

**Independent Test**: Request an unknown strategy, verify HTTP 422; trigger a delayed strategy, verify HTTP 504 after 180 seconds; confirm no silent fallback occurs.

### Tests for User Story 3

- [ ] T016 [P] [US3] Add unsupported-strategy tests in `tests/http/server.test.ts` for `422` responses and no fallback behavior
- [ ] T017 [P] [US3] Add timeout tests in `tests/http/server.test.ts` with a deterministic delayed fake strategy to verify the 180s budget and `504` error output

### Implementation for User Story 3

- [ ] T018 [US3] Implement explicit unknown-strategy handling in `src/http/server.ts` and `src/agentes/index.ts` to surface HTTP 422 with the selected strategy name
- [ ] T019 [US3] Enforce the request timeout and error mapping in `src/http/server.ts` so overrun requests return `504 Gateway Timeout` with actionable context

**Checkpoint**: The HTTP contract handles invalid input, incompatible strategy resolution, and timeouts without breaking the success path.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Validate the end-to-end feature and finalize the contract documentation.

- [ ] T020 [P] Review and update `specs/003-http-chat-registry/quickstart.md` to match the verified request/response contract and timeout behavior
- [ ] T021 [P] Verify the HTTP contract in `specs/003-http-chat-registry/contracts/chat-http.md` against the implemented route, registry, and error mapping
- [ ] T022 Run `npm test` and fix any integration/test regressions across `tests/http/server.test.ts` and `tests/agents/registry.test.ts`
- [ ] T023 Run `npm run typecheck` and resolve any TypeScript issues in `src/http/server.ts`, `src/agentes/index.ts`, and associated tests

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; can start immediately.
- **Foundational (Phase 2)**: Must complete before User Story 1, 2, or 3 work.
- **User Story 1 (Phase 3)**: Depends on the request validation and core handler from Phase 2.
- **User Story 2 (Phase 4)**: Depends on the registry and reflection selection built in Phase 2; can proceed after the default request contract is stable.
- **User Story 3 (Phase 5)**: Depends on the request/registry foundation and may be implemented in parallel with the final polish once the core path is working.
- **Polish (Phase 6)**: Depends on all user stories being complete.

### User Story Dependencies

- **User Story 1 (P1)**: Independent; can be implemented after the foundation is ready.
- **User Story 2 (P1)**: Depends on the registry and reflection contract from the foundation; independent of the timeout path.
- **User Story 3 (P2)**: Depends on the request boundary behavior already implemented; can be exercised in parallel once the success path is stable.

### Parallel Opportunities

- T001 and T002 can run in parallel during setup.
- T004 and T005 can be implemented in parallel after validation helpers are ready.
- T007 and T008 are parallel tests under User Story 1.
- T011 and T012 are parallel tests under User Story 2.
- T016 and T017 are parallel tests under User Story 3.
- T020 and T021 can run in parallel during the final polish phase.

---

## Parallel Example: User Story 1

```text
Task T007: Add successful default-request integration tests in tests/http/server.test.ts
Task T008: Add invalid-body integration tests in tests/http/server.test.ts
```

---

## Implementation Strategy

### MVP First

1. Complete the request validation and strategy registry foundation.
2. Deliver User Story 1: default valid request and invalid body handling.
3. Validate the HTTP success contract and error mapping before expanding to strategy selection and reflection.

### Incremental Delivery

1. Build the validation and registry foundation.
2. Add the default success path and invalid-body behavior.
3. Add registry routing for supported strategies and reflection opt-in.
4. Add timeout and unknown-strategy safeguards.
5. Finish with cross-cutting validation, docs, and type/test verification.
