# Tasks: Persistent Chat Conversations

**Input**: Design documents from `/specs/007-persistent-chat/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/chat-http.md, quickstart.md

**Tests**: Required by FR-013 and the project constitution; use `node:test` via `tsx`, isolated SQLite, and a deterministic fake strategy.

**Organization**: Tasks are grouped by user story to enable incremental implementation and verification.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel with other explicitly marked tasks in the same phase because it changes separate files and has no incomplete dependency.
- **[Story]**: User story served by a story-phase task.
- Each task includes its concrete source/test/documentation file path.

## Phase 1: Setup

**Purpose**: Prepare deterministic reusable test support for the feature.

- [X] T001 [P] Create a typed fake `ReasoningStrategy` test helper that captures input and returns configurable `StrategyResult` values in `tests/helpers/fake-reasoning-strategy.ts`.

## Phase 2: Foundational

**Purpose**: Define shared domain contracts and errors required by the storage and HTTP stories.

- [X] T002 Add Zod schemas and inferred types for conversation/message records in `src/domain/domain.ts`, preserving these data-model constraints: conversation `id` is a "Required, non-empty, stable, unique identifier"; conversation and message `createdAt` are "Required" ISO-8601 timestamps; message `id` is a "Required, unique, monotonically increasing insertion order"; message `conversationId` is a "Required foreign key to a conversation"; `role` is "Exactly `user` or `assistant`"; and `content` is "Required, non-empty"; add an explicit unknown-conversation domain error in `src/domain/errors.ts`.

**Checkpoint**: Shared validated entities and deterministic test support are ready before story implementation.

## Phase 3: User Story 1 - Continue a persistent conversation (Priority: P1) 🎯 MVP

**Goal**: Create conversations, continue existing conversations, persist each successful exchange in order, and return the conversation identifier.

**Independent Test**: With a deterministic fake strategy and isolated store, POST without an ID then POST using the returned ID; verify the response IDs, stored user/assistant order, and 404 for an unknown ID.

### Tests for User Story 1

- [X] T003 [P] [US1] Add SQLite `:memory:` tests for conversation creation, ordered atomic user/assistant append, chronological message retrieval, positive-integer limits, foreign-key enforcement, and rejection of unknown conversations in `tests/store/sqlite-conversation-store.test.ts`.
- [X] T004 [P] [US1] Add HTTP tests for optional `conversationId`, returning a newly created ID, reusing a supplied existing ID, preserving the answer/trace/metrics response fields, and returning 404 without strategy execution for an unknown ID in `tests/http/server.test.ts`.

### Implementation for User Story 1

- [X] T005 [US1] Define the `ConversationStore` contract and implement SQLite `conversations` and `messages` tables, `create`/`append`/`lastMessages` operations, foreign keys enabled on every connection, an index beginning with `(conversation_id, id)`, query-parameter binding for positive-integer limits, and one short transaction for both messages in `src/store/conversation-store.ts` and `src/store/sqlite-conversation-store.ts`; enforce message `conversationId` as a required foreign key, `role` exactly `user` or `assistant`, and `content` required and non-empty.
- [X] T006 [US1] Extend `ChatServerOptions` and `POST /chat` orchestration to create a conversation when `conversationId` is omitted, validate a supplied ID by looking it up without silently substituting a new conversation, append the successful user/assistant pair, return `conversationId`, translate unknown IDs to HTTP 404, and preserve existing error behavior in `src/http/server.ts`; instantiate and close the persistent store alongside the operational store in `src/index.ts`.

**Checkpoint**: First-turn and follow-up requests persist complete ordered exchanges and can be independently validated; this is the MVP.

## Phase 4: User Story 2 - Receive answers informed by recent conversation history (Priority: P1)

**Goal**: Compose the latest 12 prior messages into follow-up prompts and report the exact count in `metrics.historyMessages`.

**Independent Test**: Seed more than 12 ordered messages, submit a follow-up through a fake strategy that captures input, and verify the latest 12 appear in chronological order with role labels before the current message; verify the metric equals 12.

### Tests for User Story 2

- [X] T007 [P] [US2] Add HTTP cases for empty, fewer-than-12, exactly-12, and more-than-12 histories, asserting chronological role-labelled composition, the current message last, unchanged no-history input, and exact `metrics.historyMessages` values in `tests/http/server.test.ts`.

### Implementation for User Story 2

- [X] T008 [US2] Add a deterministic prompt-composition helper that accepts the prior messages and current input, labels user/assistant roles, preserves chronology, and caps prior history at 12; integrate it with `ConversationStore.lastMessages` and validate/return `metrics.historyMessages` in the successful `/chat` response in `src/http/compose-chat-prompt.ts` and `src/http/server.ts`.

**Checkpoint**: Follow-up responses use no more than 12 prior messages and expose the count without changing existing answer or trace semantics.

## Phase 5: User Story 3 - Verify conversation behavior without external services (Priority: P2)

**Goal**: Prove persistence, error handling, and prompt behavior deterministically without model-provider or network access.

**Independent Test**: Run the conversation store and HTTP tests using SQLite `:memory:` and the fake strategy; separately reopen a temporary persistent database and verify conversation history survives.

### Tests for User Story 3

- [X] T009 [P] [US3] Add HTTP tests proving strategy failure, timeout, and malformed conversation IDs do not persist a partial user/assistant pair or create a replacement conversation, using a fake strategy and injected `:memory:` store in `tests/http/server.test.ts`.
- [X] T010 [P] [US3] Add SQLite tests proving data created with `:memory:` is isolated and an existing conversation plus ordered message history survives closing and reopening a temporary persistent database in `tests/store/sqlite-conversation-store.test.ts`.

**Checkpoint**: The feature's normal, boundary, and failure paths are repeatable without external services; no runtime feature code is needed beyond US1 and US2.

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Confirm the documented validation workflow and keep project quality gates green.

- [X] T011 Update the focused test command and expected persistence/history outcomes in `specs/007-persistent-chat/quickstart.md`.
- [X] T012 Run focused conversation tests, the full `npm test` suite, and `npm run typecheck`; resolve any feature-related failures in the relevant `src/` and `tests/` files.

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 has no dependencies and can start immediately.
- **Foundational (Phase 2)**: T002 depends on Setup and blocks story work that uses the validated domain entities.
- **User Story 1 (Phase 3)**: T003 and T004 can run in parallel after T001/T002; T005 follows T003; T006 follows T004 and T005.
- **User Story 2 (Phase 4)**: Depends on the store and endpoint from US1; T007 precedes T008.
- **User Story 3 (Phase 5)**: Depends on US1/US2 implementation; T009 and T010 target separate test files and can run in parallel.
- **Polish (Phase 6)**: T011 can run in parallel with story work after quickstart scenarios stabilize; T012 follows all implementation and tests.

### User Story Dependencies

- **US1 (P1)**: Depends only on Setup and Foundational phases; delivers the persistent conversation MVP.
- **US2 (P1)**: Depends on US1's store and `/chat` integration because it consumes persisted prior messages.
- **US3 (P2)**: Depends on US1/US2 behavior to prove offline, isolated, and failure-path coverage.

### Within Each User Story

- Write tests before implementing the corresponding behavior; confirm the tests fail for the expected missing behavior.
- Implement domain and persistence contracts before wiring the HTTP endpoint.
- Implement prompt composition only after the endpoint can retrieve conversation history.
- Keep strategy execution outside the SQLite append transaction; persist the user/assistant pair atomically after a successful answer.

### Parallel Opportunities

- **T001** can be performed independently during Setup.
- **T003** (store tests) and **T004** (HTTP contract tests) target different files and can run in parallel after shared test support and domain types exist.
- **T011** (quickstart documentation) can be edited independently of implementation once test command names are stable.
- **T009** (HTTP failure tests) and **T010** (SQLite isolation/reopen tests) can run in parallel after US1/US2 are implemented.
- US2, US3, and the endpoint implementation are not parallelizable with their prerequisite story phases.

## Parallel Example: User Story 1

```text
Task: T003 - SQLite in-memory store tests in tests/store/sqlite-conversation-store.test.ts
Task: T004 - HTTP conversation contract tests in tests/http/server.test.ts
```

After both test tasks are in place, implement T005, then wire the API and startup in T006.

## Implementation Strategy

### MVP First (User Story 1)

1. Complete Setup and Foundational phases.
2. Add US1 store and HTTP tests; confirm missing behavior fails.
3. Implement the SQLite conversation store and wire it into `POST /chat`.
4. Stop and validate conversation creation, reuse, ordered persistence, and unknown-ID handling.

### Incremental Delivery

1. Deliver US1 as the first usable persistent chat slice.
2. Add US2 recent-history prompt composition and `historyMessages`.
3. Add US3 failure, in-memory, fake-strategy, and restart verification.
4. Run focused tests, `npm test`, and `npm run typecheck`.
