# Implementation Plan: Semantic User Memory

**Branch**: `008-semantic-memory` | **Date**: 2026-10-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/008-semantic-memory/spec.md`

## Summary

Add per-user semantic facts with `remember`, `recall`, and `forget`; generate local normalized embeddings using all-MiniLM-L6-v2 with mean pooling; store Float32 vectors in SQLite BLOBs; deduplicate above `0.92`; rank the top three by dot product with inclusive threshold `0.3`; and inject recall into `/chat` when `userId` is supplied. Keep model loading lazy and injectable so test suites need neither downloads nor external inference services.

## Technical Context

**Language/Version**: TypeScript ESM, Node.js 22 LTS, strict mode.

**Primary Dependencies**: `@huggingface/transformers` for local ONNX feature extraction (`all-MiniLM-L6-v2`, mean pooling, `normalize: true`); existing Express, Zod, `node:sqlite`, and `node:test` with `tsx`.

**Storage**: SQLite at `OPSPILOT_DB`; add a `memories` table with exactly the requested columns `id`, `user_id`, `fact`, `embedding`, `created_at`. Store embeddings as a 384-dimension Float32 BLOB. Tests use `:memory:`.

**Testing**: Unit/store tests with deterministic injected embedders; lazy-loader behavior tests with a fake pipeline factory; HTTP tests with fake strategy and memory store. Run focused tests, `npm test`, and `npm run typecheck`.

**Target Platform**: Node.js service on supported Node 22+ platforms; CPU-capable local ONNX inference. First use may require downloading model assets to the configured Hugging Face cache; pre-provisioned cache is required for offline operation.

**Project Type**: TypeScript HTTP web service.

**Performance Goals**: Rank at most three memories for a chat turn; deduplicate only on similarity `> 0.92`; include recall score `>= 0.3`; initialize the model once per process on first use.

**Constraints**: Scope all reads/writes by user ID; validate vectors, BLOB size, and dimensions; do not silently treat embedding/model errors as no recall; preserve chat operation without `userId`; tests must not download or load the actual model.

**Scale/Scope**: Local SQLite scan of a user's stored memories and CPU inference; no vector index, multi-tenant authentication, fact extraction, bulk delete, or model-training workflow.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. MVC and controlled effects**: PASS. Keep model inference behind `src/memory/embeddings.ts`, persistence/scoring orchestration behind `src/memory/memory-store.ts`, and chat composition at the HTTP/service boundary.
- **II. Zod-validated contracts**: PASS. Validate user IDs, facts, IDs, embedding dimensions/finiteness, memory records, recall results, and chat request fields.
- **III. Explicit errors**: PASS. Model load, inference, corrupt BLOB, dimension mismatch, and persistence failures remain visible; they are not converted to an empty recall.
- **IV. Tests and quality**: PASS. Specify tests using `node:test`, `:memory:`, deterministic injected embeddings, and fake strategies; retain full test and typecheck gates.
- **V. Security and specification workflow**: PASS WITH DOCUMENTED SCOPE. Client-provided `userId` is trusted only as explicitly scoped by the spec; authentication/authorization is an external deployment responsibility and out of scope. No secrets are introduced.

No unresolved technical clarifications; trust boundary is documented in the spec and contract.

## Phase 0: Research

See [research.md](./research.md). Findings cover model/pipeline selection, singleton caching and local model assets, BLOB encoding, vector math, and threshold policy.

## Phase 1: Design & Contracts

- Entity, storage, and vector validation rules: [data-model.md](./data-model.md).
- Memory operations: [contracts/memory-store.md](./contracts/memory-store.md).
- HTTP request/prompt behavior: [contracts/chat-http.md](./contracts/chat-http.md).
- Runnable validation steps: [quickstart.md](./quickstart.md).

### Post-Design Constitution Check

- **I. MVC and controlled effects**: PASS. Inference, persistence, ranking, and HTTP orchestration are separated behind narrow interfaces and pure vector/composition helpers.
- **II. Zod-validated contracts**: PASS. Public request fields and stored/result data are validated; embedding output is checked before persistence or comparison.
- **III. Explicit errors**: PASS. Failed local inference, corrupt storage, and invalid vectors produce explicit errors rather than a fabricated empty result.
- **IV. Tests and quality**: PASS. In-memory store, injected embedder, fake strategy, semantic paraphrase, and full project quality checks are specified.
- **V. Security and specification workflow**: PASS WITH DOCUMENTED SCOPE. User isolation is mandatory and tested; the trusted `userId` boundary is disclosed and authentication remains outside scope.

## Project Structure

### Documentation (this feature)

```text
specs/008-semantic-memory/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── memory-store.md
│   └── chat-http.md
└── tasks.md
```

### Source Code (repository root)

```text
src/
├── http/
│   ├── server.ts                  # Optional userId and prompt injection
│   └── compose-chat-prompt.ts     # Compose memory, conversation history, current message
├── memory/
│   ├── embeddings.ts              # Lazy local model singleton and vector validation
│   ├── memory-store.ts            # MemoryStore API, SQLite persistence, dedup and recall
│   └── vector.ts                  # Pure dot-product and vector serialization helpers
├── domain/
│   └── ...                        # Memory schemas and explicit error types
└── index.ts                       # Wire shared memory store into HTTP service

tests/
├── memory/
│   ├── embeddings.test.ts
│   ├── memory-store.test.ts
│   └── vector.test.ts
└── http/
    └── server.test.ts             # userId and recall prompt injection
```

**Structure Decision**: Extend the existing single TypeScript service with a focused `src/memory/` module and extend the current `/chat` flow. The feature requires a dedicated store because vector serialization, per-user filtering, deduplication, and ranking form a separate domain from conversation messages and operational records.

## Complexity Tracking

No constitution violations or additional architectural projects are introduced. The deployment trust assumption for `userId` is explicitly documented; authentication/authorization is not implemented in this feature.
