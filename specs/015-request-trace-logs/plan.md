# Implementation Plan: Persisted Request Trace and JSON Logs

**Branch**: `015-request-trace-logs` | **Date**: 2026-10-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/015-request-trace-logs/spec.md`

## Summary

`POST /chat` gets a server-generated UUID (`requestId`) set by a middleware that runs before
body parsing, so every response (including malformed JSON) carries `X-Request-Id`, and every
body carries `requestId`. The handler's error mapping becomes a pure function
(`classifyChatError`) that yields status, error category and message. At the end of every
request a new `SqliteRequestStore` writes one `requests` row (metrics) and the ordered
`trace_events` rows (type, node, full redacted payload) in one transaction, before the
response is sent; failures there are logged and never change the response. The production
graph exposes the last observed trace (`onTrace`) so failed turns keep their partial trace.
A new `src/obs/logger.ts` writes one strict, metadata-only JSON line per event to **stderr**,
reading the current `requestId` from an `AsyncLocalStorage` request context; the existing
`console.error` diagnostics (router, strategy, model, summarizer, learning reflection) move to
it. `GET /requests/:id` returns the record plus the trace ordered by seq. See
[research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript ESM (`strict: true`) on Node.js 22 LTS

**Primary Dependencies**: Express 5 (middleware, routes), `node:sqlite` (`DatabaseSync`), `node:crypto` (`randomUUID`), `node:async_hooks` (`AsyncLocalStorage`), Zod 4, `@langchain/langgraph` (`compiled.stream` with `streamMode: "values"`)

**Storage**: existing SQLite file from `OPSPILOT_DB` (default `./data/opspilot.db`); new tables `requests` and `trace_events`; tests use `:memory:`

**Testing**: `node:test` via `tsx`; fake router/strategies/summarizer and fake models (feature 014); injectable `createRequestId`, `now` and log writer; no provider calls

**Target Platform**: Local Node.js HTTP server (MCP server and CLIs only affected by logger destination)

**Project Type**: Single-project web service

**Performance Goals**: one synchronous SQLite transaction per request (a few rows); no extra model calls

**Constraints**: storage/log failures never change a chat response; logs carry no content; stdout stays free for the MCP stdio protocol; existing `/chat` status codes and fields unchanged except the added `requestId`

**Scale/Scope**: 4 new modules (`src/obs/logger.ts`, `src/obs/request-context.ts`, `src/store/sqlite-request-store.ts`, `src/http/chat-errors.ts`), server + graph changes, 5 log call-site migrations, ~5 test files

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment | Status |
|-----------|------------|--------|
| I. MVC e efeitos controlados | Controller (`server.ts`) generates the id, calls the graph, then the store; error mapping (`classifyChatError`), record building (`buildRequestRecord`) and log-line formatting (`formatLogLine`) are pure. SQLite I/O lives in the store (Model); stderr writes only in the logger's writer. | PASS |
| II. Contratos Zod | Request id (`z.uuid()`), stored rows parsed back with Zod (`requestRecordSchema`, `traceEventSchema`), `GET /requests/:id` response schema, chat response/error schemas with `requestId`, and a strict `logEventSchema` that rejects any non-metadata field. | PASS |
| III. Erros explícitos | `UnknownRequestError` → 404 at the edge; invalid id → 400; persistence failure is logged (`persistence_failed`), not hidden and not turned into a fake success or error for the chat. | PASS |
| IV. Testes | Tests for ids (body/header/uniqueness/client header ignored), store round-trip and reopen, lookup 200/404/400, partial trace on failure, persistence failure, logger strictness and one-line-per-event. | PASS |
| V. Segurança / Spec Kit | Stored payloads are the already-redacted response events; logs are metadata-only by schema; no secrets; `.env` untouched. | PASS |
| Stack | `node:sqlite` + `OPSPILOT_DB` + `:memory:` in tests, no new dependency. | PASS |

Post-design re-check (after Phase 1): all PASS. Complexity Tracking empty.

## Project Structure

### Documentation (this feature)

```text
specs/015-request-trace-logs/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── http-requests.md     # /chat additions + GET /requests/:id
│   └── log-events.md        # JSON log line contract
├── checklists/
└── tasks.md                 # /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── obs/
│   ├── logger.ts            # NEW: logEventSchema, formatLogLine (pure), log/info/warn/error, setLogWriter
│   └── request-context.ts   # NEW: AsyncLocalStorage { requestId }, runWithRequestContext, currentRequestId
├── store/
│   ├── request-store.ts     # NEW: RequestStore interface, RequestRecord types/schemas
│   └── sqlite-request-store.ts  # NEW: requests + trace_events, record(), get()
├── domain/errors.ts         # + UnknownRequestError
├── http/
│   ├── chat-errors.ts       # NEW: classifyChatError (pure) → { status, category, message }
│   └── server.ts            # request-id middleware, requestId in bodies, persist + log, GET /requests/:id
├── graph/
│   ├── production-graph.ts  # run(input, { onTrace }) via stream(values); strategy-fallback log
│   └── router.ts            # router-fallback log
├── context/conversation-history.ts  # summarization-failed log
└── llm/model.ts             # model-fallback log

tests/
├── obs/logger.test.ts
├── obs/request-context.test.ts
├── store/sqlite-request-store.test.ts
├── http/chat-errors.test.ts
├── http/server.test.ts            # ids, lookup, persistence, logs
└── graph/production-graph.test.ts # onTrace partial trace; log assertions replace console.error mocks
```

**Structure Decision**: Single project. Observability helpers in a new `src/obs/` folder (as
named by the user); persistence follows the existing `src/store/` SQLite pattern; HTTP edge
changes stay in `src/http/`.

## Complexity Tracking

No constitution violations.
