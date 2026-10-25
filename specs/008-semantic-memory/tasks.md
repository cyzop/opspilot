# Tasks: Semantic User Memory

**Input**: Design documents from `/specs/008-semantic-memory/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/memory-store.md, contracts/chat-http.md, quickstart.md

**Tests**: Required by FR-014/FR-015 and the project constitution. Use `node:test` with `tsx`, `:memory:` storage, injected deterministic embeddings, and fake strategies; test runs must not download model assets.

**Organization**: Tasks are grouped by user story for incremental implementation and independent verification.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can be performed in parallel with other explicitly marked tasks in the same phase because file ownership is separate and dependencies are complete.
- **[Story]**: User story served by a story-phase task.
- Every task includes concrete paths and the validations/constraints it must preserve.

## Phase 1: Setup

**Purpose**: Add the inference dependency and shared deterministic test seam.

- [X] T001 Add `@huggingface/transformers` as a production dependency in `package.json` and update `package-lock.json` using the repository package manager.
- [X] T002 [P] Add a typed deterministic embedding fixture/helper supporting per-text normalized 384-value vectors and captured calls in `tests/helpers/fake-embedder.ts`.

## Phase 2: Foundational

**Purpose**: Define the validated vector and memory domain contracts used by all stories.

- [X] T003 Add Zod schemas and inferred types for memory records, recall results, user IDs, and memory IDs in `src/domain/domain.ts`; enforce the data-model constraints verbatim: `id` is “Non-empty stable identifier; primary key”, `userId` is “Non-empty user identifier; required”, `fact` is “Trimmed, non-empty text”, `embedding` is a “Required BLOB of exactly 1536 bytes, encoding 384 finite Float32 values”, `createdAt` is a “Required ISO-8601 timestamp”, and recall `score` is a finite number; add explicit memory/embedding error classes in `src/domain/errors.ts`.
- [X] T004 [P] Implement pure Float32 vector validation, BLOB encode/decode, normalized dot product, and deterministic result comparison helpers in `src/memory/vector.ts`; reject non-finite values, vectors not exactly 384 elements, BLOBs not exactly 1536 bytes, and incompatible dimensions.

**Checkpoint**: Package dependency, deterministic test seam, validated domain types, and pure vector primitives are ready for story implementation.

## Phase 3: User Story 1 - Remember and manage personal facts (Priority: P1) 🎯 MVP

**Goal**: Store user-scoped facts, reuse semantic duplicates only above the configured threshold, and delete only a user's own memory.

**Independent Test**: Use SQLite `:memory:` and deterministic vectors to remember a fact, verify deduplication only above `0.92`, forget it, and prove operations for one user do not read/delete another user's rows.

### Tests for User Story 1

- [X] T005 [P] [US1] Add `node:test` cases for scoped `remember`, duplicate reuse versus insertion at `> 0.92` and exactly `0.92`, scoped `forget`, missing/foreign-owned IDs, invalid facts/users/vectors, and `:memory:` isolation in `tests/memory/memory-store.test.ts`.

### Implementation for User Story 1

- [X] T006 [US1] Implement the lazy local embedding singleton in `src/memory/embeddings.ts` using task `feature-extraction`, model `onnx-community/all-MiniLM-L6-v2-ONNX`, `pooling: "mean"`, and `normalize: true`; validate one Float32 vector of exactly 384 finite values, share concurrent first-load work, and clear a rejected initialization promise to permit retry.
- [X] T007 [US1] Implement `MemoryStore` and SQLite `memories` schema/operations in `src/memory/memory-store.ts` using exactly columns `id`, `user_id`, `fact`, `embedding`, `created_at`; scope all queries by `user_id`, persist 1536-byte Float32 BLOBs, validate rows when read, make `remember` reuse the highest same-user match only when the unrounded dot product is strictly greater than `0.92`, and make `forget` delete by both `user_id` and `id` while returning whether a row was removed.
- [X] T008 [US1] Complete and verify store tests for atomic insertion/dedup outcomes, other-user isolation, and forget behavior using the deterministic embedder in `tests/memory/memory-store.test.ts`.

**Checkpoint**: Facts can be explicitly stored, deduplicated under the strict threshold, and forgotten without crossing user boundaries; this is the MVP.

## Phase 4: User Story 2 - Recall relevant facts by meaning (Priority: P1)

**Goal**: Retrieve at most the three most relevant facts for one user through normalized-vector dot product.

**Independent Test**: Seed/inject deterministic normalized vectors, query with a paraphrase fixture that has no meaningful words in common with its saved fact, and verify that fact is returned while lower-scoring and other-user facts are excluded.

### Tests for User Story 2

- [X] T009 [P] [US2] Add vector unit tests for Float32 BLOB round-trips, corrupt byte lengths, non-finite values, incompatible dimensions, dot-product scores, and deterministic tie ordering in `tests/memory/vector.test.ts`.
- [X] T010 [P] [US2] Add recall tests for inclusive `0.3`, exclusion below `0.3`, strict top-three ordering, stable ties, cross-user isolation, empty successful recall, and a no-lexical-overlap paraphrase mapped to semantically matching deterministic vectors in `tests/memory/memory-store.test.ts`.
- [X] T011 [P] [US2] Add lazy singleton tests verifying no initialization before first use, one shared initialization across concurrent calls, mean pooling/normalization configuration, and retry after initialization failure using an injected fake pipeline factory in `tests/memory/embeddings.test.ts`.

### Implementation for User Story 2

- [X] T012 [US2] Implement `recall(userId, query)` in `src/memory/memory-store.ts`: validate/embed the query, read only that user's memories, validate every stored embedding BLOB, compute unrounded dot products, include scores `>= 0.3`, sort by score descending then `created_at` and `id`, and return no more than three; surface corrupt-vector and embedding errors instead of returning an empty list.
- [X] T013 [US2] Refactor `src/memory/embeddings.ts` to expose a narrow injectable pipeline factory/test reset seam without changing production lazy-singleton behavior, and make `tests/memory/embeddings.test.ts` exercise the production configuration without loading/downloading the real model.

**Checkpoint**: Recall returns semantically relevant user-owned facts within exact score/count rules, and vector/model behavior is deterministic to test.

## Phase 5: User Story 3 - Use recalled facts in chat (Priority: P1)

**Goal**: Accept an optional user ID in `/chat` and inject that user's non-empty recall results before conversation history and current input.

**Independent Test**: Submit a chat request for a user with a relevant injected memory result and fake strategy; verify the memory appears before conversation history/current message. Verify missing `userId` makes no memory call and empty recall adds no section.

### Tests for User Story 3

- [X] T014 [P] [US3] Add `/chat` tests for valid/blank/omitted `userId`, correct per-user memory lookup, memory-before-history prompt order, no empty memory section, unchanged requests without `userId`, and explicit failure when recall rejects in `tests/http/server.test.ts`.

### Implementation for User Story 3

- [X] T015 [US3] Extend chat request validation with optional trimmed non-empty `userId` and extend `ChatServerOptions` with an injectable `MemoryStore`; when `userId` exists, await `recall(userId, message)` and compose returned facts before conversation history/current message, while skipping recall entirely when absent in `src/http/server.ts` and `src/http/compose-chat-prompt.ts`.
- [X] T016 [US3] Wire one production SQLite memory store using the same `OPSPILOT_DB` configuration into application startup and close it with the other stores in `src/index.ts`; keep initialization of the embedding model lazy so requests without `userId` do not load it.

**Checkpoint**: Chat uses only the requesting user's relevant facts, keeps old callers unchanged, and surfaces memory failures explicitly.

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Document operational model setup and verify the complete feature.

- [X] T017 Update `specs/008-semantic-memory/quickstart.md` with actual focused test selectors, deterministic no-download validation, and the deployment step for provisioning/caching model assets before offline use.
- [X] T018 Run focused memory/vector/embedding/chat tests, `npm test`, and `npm run typecheck`; resolve feature-related failures in the relevant `src/` and `tests/` files without weakening threshold, isolation, or error semantics.

## Phase 7: HTTP write path for memories (follow-up to US1)

**Goal**: Let a client save a fact over HTTP so that `/chat` recall has data to use.

- [X] T019 [US1] Add `/memories` tests in `tests/http/server.test.ts`: `201` insertion, `200` near-duplicate reuse, no embedding in the response, recall by a later `/chat` for the same user only, `400` for missing/blank/unknown fields, and `500` for store failures or a missing store.
- [X] T020 [US1] Implement `POST /memories` in `src/http/server.ts` with a strict `userId`/`fact` request schema delegating to `MemoryStore.remember`, and document it in `contracts/memories-http.md`, `spec.md` (FR-016, FR-017), and `quickstart.md`.

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 updates the package manifest/lockfile; T002 creates the independent test seam. T004 should wait for the memory module directory to exist, but can be prepared alongside T003 after setup.
- **Foundational (Phase 2)**: T003 and T004 depend on setup; story work that uses the memory schemas/vector helpers waits for this phase. T003 and T004 can run in parallel after setup because they change separate files.
- **User Story 1 (Phase 3)**: T005 is written first; T006/T007 implement the model and store; T008 completes verification after implementation. The embedding API in T006 is a prerequisite for production `remember` in T007.
- **User Story 2 (Phase 4)**: T009/T010/T011 are independent test files and can run in parallel after foundational work. T012 implements retrieval after the store and vector helpers; T013 follows T006 to exercise configurable initialization.
- **User Story 3 (Phase 5)**: T014 is written before T015; T015 depends on recall from US2; T016 wires the production store after its constructor/API is stable.
- **Polish (Phase 6)**: T017 can proceed once validation selectors are stable; T018 follows all feature changes.

### User Story Dependencies

- **US1 (P1)**: Depends on Setup and Foundational; provides the persistent fact lifecycle MVP.
- **US2 (P1)**: Depends on US1 persistence and shared vector primitives; adds semantic ranking.
- **US3 (P1)**: Depends on US2 recall; adds chat prompt use of results.

### Within Each User Story

- Write and run the story tests before implementation; confirm expected failures for missing behavior.
- Implement domain/vector primitives before SQLite use.
- Keep database I/O in the memory store, local model loading in `embeddings.ts`, and HTTP orchestration in the chat boundary.
- Do not catch embedding/storage errors and convert them into empty recall.
- Keep automatic tests independent from Hugging Face network/model downloads.

### Parallel Opportunities

- **T002** can be implemented while T001 updates package metadata.
- Within US2, **T009** (vector tests), **T010** (recall scenarios), and **T011** (lazy-loader test seam) can run in parallel because they use separate files. T005 and T010 are in separate story phases but both touch `tests/memory/memory-store.test.ts`, so those edits must be sequential.
- In US3, chat HTTP tests in `tests/http/server.test.ts` are separate from memory implementation work until the integration task T015.
- Documentation task T017 can be handled separately from source files once the final validation commands are fixed.

## Parallel Example: User Story 2

```text
Task: T009 - Vector serialization and dot-product tests in tests/memory/vector.test.ts
Task: T010 - Recall threshold/top-three/isolation tests in tests/memory/memory-store.test.ts
Task: T011 - Lazy model singleton tests in tests/memory/embeddings.test.ts
```

Implement T012/T013 after these test expectations are established.

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Setup and Foundational phases.
2. Add US1 store tests with injected deterministic embeddings.
3. Implement the lazy model adapter and user-scoped SQLite store with strict deduplication and forgetting.
4. Stop and validate insertion, deduplication, forget, and isolation independently.

### Incremental Delivery

1. Deliver US1 as the persistent-memory lifecycle MVP.
2. Add US2 ranking, threshold behavior, malformed-vector checks, lazy model tests, and paraphrase recall.
3. Add US3 optional `userId` and chat prompt injection.
4. Run focused tests, `npm test`, and `npm run typecheck`.
