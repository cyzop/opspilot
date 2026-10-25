---

description: "Task list for the external provider status check feature"
---

# Tasks: External Provider Status Check

**Input**: Design documents from `specs/005-provider-status-tool/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/provider-status-tool.md](./contracts/provider-status-tool.md)

**Tests**: Tests are included because the specification explicitly requires deterministic fake-fetch coverage without network access.

**Organization**: Tasks are grouped by user story so the normal lookup and failure-resilience increments can be implemented and verified separately.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel with another task because it touches a different file and has no incomplete-task dependency.
- **[Story]**: User story served by the task.
- Every task description names its target file.

## Phase 1: Setup

**Purpose**: Project initialization and basic structure.

No setup tasks are needed: the TypeScript project, tool directory, test runner, and dependencies already exist.

---

## Phase 2: Foundational

**Purpose**: Shared prerequisites that must be complete before user-story implementation.

No foundational tasks are needed: this feature has no shared infrastructure, persistence, or dependency changes.

---

## Phase 3: User Story 1 - Check whether a dependency provider is experiencing an incident (Priority: P1) 🎯 MVP

**Goal**: Let the agent check GitHub by default or Cloudflare explicitly and report the validated provider status compactly.

**Independent Test**: With fake fetch responses and no network, verify the default maps to GitHub, explicit `cloudflare` maps to Cloudflare, and each result is one line containing the provider's actual indicator and description.

### Tests for User Story 1

- [X] T001 [P] [US1] Add fake-fetch tests for default GitHub selection, explicit Cloudflare selection, and compact single-line reporting of both healthy and non-healthy statuses in `tests/tools/check-provider-status.test.ts`.
- [X] T002 [P] [US1] Add a registry test confirming `check_provider_status` is returned by `createOpsTools`, whose output also supplies the derived `opsTools` registry, in `tests/tools/index.test.ts`.

### Implementation for User Story 1

- [X] T003 [US1] Implement the `check_provider_status` tool factory, provider input enum with GitHub default and field description, fixed provider-to-URL mapping, injectable fetch, Zod validation of non-empty `status.indicator` and `status.description`, and compact one-line status formatting in `src/tools/check-provider-status.ts`.
- [X] T004 [US1] Register the provider status tool in `createOpsTools` and the exported `opsTools` collection without changing existing registrations in `src/tools/index.ts`.

**Checkpoint**: The P1 lookup works for both providers, reports their actual status, and is available to both strategies through the shared tool registry.

---

## Phase 4: User Story 2 - Receive a usable result when the status check fails (Priority: P2)

**Goal**: Bound provider lookups, retry transient failures exactly once, and surface final failures as readable tool observations instead of thrown exceptions.

**Independent Test**: With injected fake fetches and no network, verify five-second abort signals, one retry maximum for network errors/timeouts/HTTP 5xx, no retry for other HTTP errors or invalid response data, and readable single-line results without escaped exceptions.

### Tests for User Story 2

- [X] T005 [US2] Extend fake-fetch coverage for abort/timeout and network failures, HTTP 5xx retry with success and exhaustion, no retry for non-5xx HTTP errors, malformed JSON and invalid/missing status fields, and readable non-throwing single-line failures in `tests/tools/check-provider-status.test.ts`.

### Implementation for User Story 2

- [X] T006 [US2] Add a fresh `AbortSignal.timeout(5000)` per fetch attempt, exactly one retry for network failures/timeouts and HTTP 5xx, terminal handling for other non-success HTTP/JSON/schema failures, and readable error strings that never escape the tool boundary in `src/tools/check-provider-status.ts`.

**Checkpoint**: The P2 failure cases are bounded and observable; the agent can continue without treating failed or invalid data as healthy.

---

## Phase 5: Polish & Cross-Cutting Validation

**Purpose**: Verify the complete feature against project quality gates.

- [X] T007 Run the test suite and TypeScript typecheck (`npm test` and `npm run typecheck`) defined in `package.json`; resolve any failures related to the provider tool or its registration.

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No tasks; project structure and dependencies already exist.
- **Foundational (Phase 2)**: No tasks; no shared prerequisite is introduced.
- **User Stories (Phase 3+)**: US1 starts immediately. US2 follows US1 because it extends the same provider tool implementation.
- **Polish (Phase 5)**: Depends on US1 and US2 implementation being complete.

### User Story Dependencies

- **User Story 1 (P1)**: No dependency on another story; delivers the MVP provider lookup.
- **User Story 2 (P2)**: Depends on US1's tool and registry; adds retry and terminal failure behavior.

### Within Each User Story

- Tests are written before their corresponding implementation tasks.
- US1's fake-fetch test file (`T001`) and registry test file (`T002`) can be created in parallel because they are separate files.
- Implement the tool (`T003`) before registering it (`T004`).
- Complete US1 before adding US2 failure tests and behavior.
- Run project-wide tests and typecheck after all story work.

### Parallel Opportunities

- **US1**: `T001` and `T002` can run in parallel; they touch distinct test files.
- **US2**: No parallel implementation opportunity is required; its tests and implementation touch the same tool test/source files and should be sequenced.

## Parallel Example: User Story 1

```text
In parallel:
  T001 - Add provider lookup tests in tests/tools/check-provider-status.test.ts
  T002 - Add tool registry tests in tests/tools/index.test.ts

Then:
  T003 - Implement src/tools/check-provider-status.ts
  T004 - Register in src/tools/index.ts
```

## Implementation Strategy

1. Deliver the P1 MVP first: verify success paths for both providers, implement the tool, and register it.
2. Add P2 resilience coverage and implement bounded retry and readable error outcomes.
3. Run `npm test` and `npm run typecheck` as the final quality gate.
