# Implementation Plan: Persistent Chat Conversations

**Branch**: `007-persistent-chat` | **Date**: 2026-10-12 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-persistent-chat/spec.md`

## Summary

Add persistent conversations to `POST /chat`: create a conversation when no ID is supplied, reuse a validated existing ID, compose the latest 12 prior user/assistant messages before the current question, persist successful turns in order, and return `conversationId` plus `metrics.historyMessages`. Use a separate `ConversationStore` and SQLite persistence with a short transaction for each successful user/assistant pair. Keep the HTTP boundary, strategy registry, and response contract compatible with the existing chat flow.

## Technical Context

**Language/Version**: TypeScript ESM, Node.js 22 LTS, strict mode.

**Primary Dependencies**: Express 5, Zod 4, built-in `node:sqlite` (`DatabaseSync`), `node:test` with `tsx`.

**Storage**: SQLite via `OPSPILOT_DB`; the new store shares the existing database path and uses `conversations` and `messages` tables. Tests use `:memory:` for isolation.

**Testing**: `node:test` via `tsx`; deterministic fake `ReasoningStrategy` for HTTP/composition tests, plus isolated SQLite store tests. Run `npm test` and `npm run typecheck`.

**Target Platform**: Node.js service on supported Node 22+ environments.

**Project Type**: TypeScript HTTP web service.

**Performance Goals**: Retrieve at most 12 prior messages per request; preserve the existing 180-second chat execution timeout.

**Constraints**: Validate external request and persisted message data at boundaries; do not persist a partial user/assistant pair on strategy failure; avoid provider/network dependencies in tests; preserve existing chat error behavior except for unknown conversation IDs.

**Scale/Scope**: One local OpsPilot database and single-user conversations without ownership, expiry, deletion, or multi-user access control in this feature.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. MVC and controlled effects**: PASS. Keep persistence in a store, HTTP orchestration at the controller boundary, and prompt composition in a pure helper/service path.
- **II. Zod-validated contracts**: PASS. Extend the request schema and validate message entities and successful response metrics at their boundaries.
- **III. Explicit errors**: PASS. Model unknown conversations as a domain error and translate it to HTTP 404; propagate storage and strategy failures through existing error handling.
- **IV. Tests and quality**: PASS. Specify store and HTTP integration tests with `node:test`, in-memory SQLite, and a fake strategy; retain typecheck and test-suite gates.
- **V. Security and specification workflow**: PASS. This plan follows the approved feature spec; no secrets or environment-file content are needed.

No gate violations or unresolved technical clarifications.

## Phase 0: Research

See [research.md](./research.md). Decisions use the repository's existing SQLite, Express, Zod, and testing conventions; no external dependency or open technical question is required.

## Phase 1: Design & Contracts

- Data entities and persistence constraints: [data-model.md](./data-model.md).
- HTTP request/response and error contract: [contracts/chat-http.md](./contracts/chat-http.md).
- Validation scenarios and commands: [quickstart.md](./quickstart.md).

### Post-Design Constitution Check

- **I. MVC and controlled effects**: PASS. `ConversationStore` owns persistence; `/chat` orchestrates requests; context composition is deterministic and isolated from storage I/O.
- **II. Zod-validated contracts**: PASS. Request, message, and response fields have explicit validation requirements.
- **III. Explicit errors**: PASS. Unknown conversation identifiers return 404; storage and reasoning failures are not converted to success.
- **IV. Tests and quality**: PASS. Design includes memory-store, SQLite `:memory:`, and fake-strategy tests, with the project's test and typecheck commands.
- **V. Security and specification workflow**: PASS. Persistent data stays in the configured local store; no new secret handling or external service is introduced.

## Project Structure

### Documentation (this feature)

```text
specs/007-persistent-chat/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── chat-http.md
└── tasks.md
```

### Source Code (repository root)

```text
src/
├── domain/
│   └── ...                       # Conversation/message schemas and domain errors
├── http/
│   └── server.ts                 # Request orchestration and HTTP contract
├── store/
│   ├── conversation-store.ts     # ConversationStore contract and test fake
│   └── sqlite-conversation-store.ts
└── index.ts                      # Wire persistent store into application startup

tests/
├── http/
│   └── server.test.ts            # Endpoint, history composition, and fake strategy
└── store/
    └── sqlite-conversation-store.test.ts
```

**Structure Decision**: Extend the existing single TypeScript service and its `src/http`, `src/domain`, and `src/store` layers. Keep conversation persistence separate from `OpsStore` because its lifecycle and entities are specific to chat. Put new tests next to their existing HTTP/store test suites.

## Complexity Tracking

No constitution violations or additional architectural projects are introduced.
