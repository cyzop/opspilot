---
description: "Implementation tasks for SQLite Ops persistence"
---

# Tasks: SQLite Ops Persistence

**Input**: Design documents from `specs/004-sqlite-ops-store/`

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, and `contracts/ops-tools.md`.

**Tests**: In-memory SQLite tests are required for seed, incident lifecycle, filters, CHECK constraints, and tool compatibility.

**Organization**: Tasks are grouped by user story and follow the required checklist format.

## Phase 1: Setup

**Purpose**: Prepare the persistence and testing surface for the SQLite-backed store.

- [X] T001 [P] Create the SQLite store and test directories in `src/store/` and `tests/store/` to match the implementation plan
- [X] T002 [P] Review the existing domain contract in `src/domain/domain.ts`, `src/domain/ops-service.ts`, and `src/store/ops-store.ts` before adding the SQLite adapter
- [X] T003 Confirm the runtime database path and environment contract in `src/store/ops-database.ts` so `OPSPILOT_DB` and `:memory:` remain the supported entry points

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Establish the persistence contract and schema foundation before user story work.

- [X] T004 Implement the SQLite store scaffolding in `src/store/sqlite-ops-store.ts` with `DatabaseSync`, environment-path resolution, and the `OpsStore` interface contract
- [X] T005 [P] Add the idempotent `CREATE TABLE IF NOT EXISTS` schema in `src/store/sqlite-ops-store.ts` for `services`, `alerts`, `incidentes`, and `runbooks`
- [X] T006 [P] Add domain-side and SQLite-side enum validation for the current domain values `severity` and `status` (Service has no `tier` field) in `src/domain/domain.ts` and `src/store/sqlite-ops-store.ts`
- [X] T007 Implement the seed routine for the Mercadinho scenario in `src/store/sqlite-ops-store.ts`, including 5 services, 6 alerts, and runbooks for checkout, payments, and auth
- [X] T008 Ensure all read/write operations in `src/store/sqlite-ops-store.ts` use prepared statements and no SQL string concatenation
- [X] T009 Inject `SqliteOpsStore` into the production strategy composition in `src/index.ts` while keeping `createOpsStore` as the in-memory mock for tests and benchmarks
- [X] T010 Add constructor-level schema validation and integrity checks for unknown service references in `src/store/sqlite-ops-store.ts`

**Checkpoint**: The SQLite store can initialize safely, seed idempotently, and satisfy the existing `OpsStore` contract before story implementation begins.

---

## Phase 3: User Story 1 - Persist operational data in a durable local store (Priority: P1) 🎯 MVP

**Goal**: Deliver a real SQLite-backed persistence layer with a testable Mercadinho seed and deterministic in-memory behavior.

**Independent Test**: Initialize a SQLite store in `:memory:` mode, run the seed, reopen or reuse the store, and verify the service/alert/runbook data remains present and valid.

### Tests for User Story 1

- [X] T011 [P] [US1] Add SQLite seed tests in `tests/store/sqlite-ops-store.test.ts` covering `:memory:`, idempotent initialization, and the 5-service/6-alert scenario
- [X] T012 [P] [US1] Add schema constraint tests in `tests/store/sqlite-ops-store.test.ts` to confirm invalid enum values are rejected by SQLite `CHECK` rules

### Implementation for User Story 1

- [X] T013 [US1] Implement the default `OPSPILOT_DB` path logic and `:memory:` override in `src/store/sqlite-ops-store.ts`
- [X] T014 [US1] Implement datastore read/write methods for `listServices`, `listAlerts`, and seed-backed initialization in `src/store/sqlite-ops-store.ts`
- [X] T015 [US1] Add store-level guards for invalid domain records and unknown service references in `src/store/sqlite-ops-store.ts`

**Checkpoint**: User Story 1 is independently testable and persists the canonical operational seed without creating duplicate records.

---

## Phase 4: User Story 2 - Query and manage incidents with valid filters and lifecycle states (Priority: P1)

**Goal**: Support incident lifecycle operations and filtered retrieval through the real store contract.

**Independent Test**: Open and resolve incidents against an in-memory SQLite database, then verify default `open`, explicit `resolved`, and `all` filters behave correctly with timestamps and summaries.

### Tests for User Story 2

- [X] T016 [P] [US2] Add open/list/resolve tests in `tests/store/sqlite-ops-store.test.ts` for default open filtering and explicit resolved/all filters
- [X] T017 [P] [US2] Add incident lifecycle tests in `tests/store/sqlite-ops-store.test.ts` to verify `resolved_at` and summary are set when closing an incident

### Implementation for User Story 2

- [X] T018 [US2] Implement `listIncidents` and filtering logic in `src/store/sqlite-ops-store.ts` for `open`, `resolved`, and `all` with stable ordering
- [X] T019 [US2] Implement `openIncident` and `resolveIncident` in `src/store/sqlite-ops-store.ts` using validated domain inputs and explicit error handling
- [X] T020 [US2] Update the domain contract in `src/domain/domain.ts` and `src/domain/errors.ts` to reflect incident lifecycle requirements including nullable `resolved_at` and summary handling

**Checkpoint**: User Story 2 is independently testable and consistently tracks active versus resolved incidents.

---

## Phase 5: User Story 3 - Expose operational tools and runbook lookup consistently (Priority: P2)

**Goal**: Add incident listing and runbook guidance tools without breaking the existing tool suite.

**Independent Test**: Invoke the new tool definitions against the SQLite-backed store and verify enum values, default behavior, and runbook retrieval for a known service.

### Tests for User Story 3

- [X] T021 [P] [US3] Add tool tests in `tests/tools/list-incidentes.test.ts` for `list_incidentes` defaulting to `open` and accepting `resolved` and `all`
- [X] T022 [P] [US3] Add runbook lookup tests in `tests/tools/consultar-runbook.test.ts` for seeded runbook keys and unknown runbook handling

### Implementation for User Story 3

- [X] T023 [US3] Add the `list_incidentes` tool in `src/tools/list-incidentes.ts` and register it in `src/tools/index.ts` with a clear description and enum schema
- [X] T024 [US3] Add the `consultar_runbook` tool in `src/tools/consultar-runbook.ts` and register it in `src/tools/index.ts` for service-specific runbook lookup
- [X] T025 [US3] Review and tighten the tool descriptions in `src/tools/open-incident.ts`, `src/tools/list-alerts.ts`, and `src/tools/resolve-incident.ts` to follow the six description rules, including `.describe()`, explicit enums, and open-incident guidance

**Checkpoint**: User Story 3 is independently testable and the tool layer gives operators clear action guidance for incidents and runbooks.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Finalize the persistence layer, validate docs, and ensure the project remains green.

- [X] T026 [P] Update `specs/004-sqlite-ops-store/quickstart.md` to match the verified in-memory SQLite flow and production path configuration
- [X] T027 [P] Review `specs/004-sqlite-ops-store/contracts/ops-tools.md` against the final tool semantics and confirm the incident and runbook contract matches the implementation
- [X] T028 Run `npm test` and fix any regressions across `tests/store/sqlite-ops-store.test.ts`, `tests/tools/`, and the existing domain/tool suite
- [X] T029 Run `npm run typecheck` and resolve any TypeScript issues in `src/store/`, `src/tools/`, and the related test files
- [X] T030 Ensure `.gitignore` excludes `data/` and no SQLite runtime file is committed to the repository

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies; can start immediately.
- **Foundational (Phase 2)**: Must complete before User Story 1, 2, or 3 work.
- **User Story 1 (Phase 3)**: Depends on Phase 2 and is the first persisted data slice.
- **User Story 2 (Phase 4)**: Depends on Phase 2 and can begin after the core schema and seed work is stable.
- **User Story 3 (Phase 5)**: Depends on Phase 2 and the store contract being available.
- **Polish (Phase 6)**: Depends on all user stories completing successfully.

### User Story Dependencies

- **User Story 1 (P1)**: Independent; can be implemented after the foundation is ready.
- **User Story 2 (P1)**: Depends on the persistent incident and service model constructed in User Story 1.
- **User Story 3 (P2)**: Depends on the persisted data model and store contract and should be implementable after US1/US2 are stable.

### Parallel Opportunities

- T001 and T002 can run in parallel during Setup.
- T005, T006, and T007 can be implemented in parallel once the schema foundation is started.
- T011 and T012 can run in parallel within User Story 1.
- T016 and T017 can run in parallel within User Story 2.
- T021 and T022 can run in parallel within User Story 3.
- T026 and T027 can run in parallel during the final polish phase.

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. Stop and validate the in-memory SQLite seed and schema behavior
5. Only then continue to incident lifecycle and tool work

### Incremental Delivery

1. Complete the SQLite schema and seed foundation.
2. Implement incident listing, opening, and resolution.
3. Add the tool layer and descriptive helper contracts.
4. Finalize validations, documentation, and repository hygiene.

## Estimated Delivery Plan

- MVP: User Story 1
- Added operational value: User Story 2
- Agent usability improvement: User Story 3
- Final validation: Polish phase
