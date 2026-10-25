---

description: "Task list for Persisted Request Trace and JSON Logs"
---

# Tasks: Persisted Request Trace and JSON Logs

**Input**: Design documents from `/specs/015-request-trace-logs/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/http-requests.md, contracts/log-events.md, quickstart.md

**Tests**: Required by the spec (FR-015) and constitution IV. Tests first; they must fail before the implementation. No provider calls (fake router/strategies/summarizer, fake models from feature 014); every SQLite store in tests uses `":memory:"` or a temp file.

**Implementation note**: per the `/speckit-implement` input (an `answerNode` sketch), the record also stores `route` (strategy that answered) and `userId`, and trace rows/log lines use `seq` instead of `position`. Saving stays at the HTTP edge (not in the graph's response node) so failed turns (400/404/422/503/504/500) are recorded too, and the full turn trace is stored (not only `state.result.trace`). A leaf `src/graph/routes.ts` breaks the router → logger → request-store → router import cycle.

**Organization**: US1 = request id in body and header, US2 = persisted record + ordered trace + `GET /requests/:id`, US3 = metadata-only JSON logs.

## Format: `[ID] [P?] [Story] Description`

- Paths are relative to the `ops-pilot/` project root

---

## Phase 1: Setup

- [X] T001 [P] Add `export class UnknownRequestError extends OpsPilotError {}` to `src/domain/errors.ts`
- [X] T002 [P] Create `src/store/request-store.ts` exporting: `errorCategorySchema = z.enum(["invalid_request","unknown_conversation","unknown_strategy","model_unavailable","timeout","internal"])`; `requestMetricsSchema = z.object({ llmCalls: z.number().int().nonnegative(), latencyMs: z.number().finite().nonnegative(), promptTokens: z.number().int().nonnegative().nullable(), historyMessages: z.number().int().nonnegative(), modelUsed: z.string().min(1) }).strict()`; `requestRecordSchema = z.object({ id: z.uuid(), startedAt: z.iso.datetime(), durationMs: z.number().int().nonnegative(), status: z.number().int().min(100).max(599), errorCategory: errorCategorySchema.nullable(), conversationId: z.string().nullable(), requestedRoute: routeSchema.nullable(), metrics: requestMetricsSchema.nullable() }).strict()` with a refine "`errorCategory` is null and `metrics` is non-null iff `status === 200`"; types `ErrorCategory`, `RequestMetrics`, `RequestRecord`; and `interface RequestStore { record(record: RequestRecord, trace: readonly TraceEvent[]): void; get(id: string): { record: RequestRecord; trace: TraceEvent[] } | undefined; close(): void }`

---

## Phase 2: Foundational (blocks all stories)

- [X] T003 [P] Write failing tests in `tests/obs/request-context.test.ts`: `currentRequestId()` is `undefined` outside a scope; inside `runWithRequestContext({ requestId }, fn)` it returns the id across `await`s and nested promises; two concurrent scopes keep their own ids; `runWithRequestContext` returns `fn`'s value (sync and async)
- [X] T004 Create `src/obs/request-context.ts` with `AsyncLocalStorage<{ requestId: string }>` from `node:async_hooks`, exporting `runWithRequestContext<T>(context: { requestId: string }, fn: () => T): T` and `currentRequestId(): string | undefined`. Makes T003 pass
- [X] T005 [P] Write failing tests in `tests/obs/logger.test.ts`: `formatLogLine(event)` returns one line ending in `"\n"` with no other newline; `logEvent("info", "request_started", {})` writes through the writer set by `setLogWriter` (restore function puts the previous writer back); each line parses as JSON with `ts` (ISO), `level`, `event`; inside `runWithRequestContext` the line has `requestId`, outside it does not; unknown keys (`content`, `reason`, `answer`, `args`, `message`, `userId`) are dropped, never written; an invalid value (e.g. `position: -1`) is dropped instead of throwing; a writer that throws does not propagate the error; default writer targets `process.stderr` (assert by mocking `process.stderr.write`, and that `process.stdout.write` is not called)
- [X] T006 Create `src/obs/logger.ts` per data-model.md "LogEvent" and contracts/log-events.md: `logLevelSchema = z.enum(["info","warn","error"])`; `logEventNameSchema = z.enum(["request_started","trace_event","request_finished","persistence_failed","router_fallback","strategy_fallback","model_fallback","summarization_failed","learning_reflection_failed"])`; strict `logFieldsSchema` with optional `requestId: z.uuid()`, `node: graphNodeSchema`, `type: z.string().min(1)`, `position: z.number().int().nonnegative()`, `route: routeSchema`, `status: z.number().int()`, `durationMs: z.number().int().nonnegative()`, `errorCategory: errorCategorySchema.or(z.literal("persistence"))`, `traceEvents: z.number().int().nonnegative()`, `llmCalls: z.number().int().nonnegative()`, `promptTokens: z.number().int().nonnegative().nullable()`, `modelUsed`/`primaryModel`/`reserveModel`/`conversationId: z.string().min(1)`; pure `formatLogLine(event): string`; `logEvent(level, event, fields = {})` that keeps only fields passing their own schema, adds `ts: new Date().toISOString()` and `requestId: currentRequestId()` when present, and calls the writer inside `try/catch`; `setLogWriter(writer: (line: string) => void): () => void`; default writer `(line) => process.stderr.write(line)`. Makes T005 pass
- [X] T007 [P] Create `tests/helpers/capture-logs.ts` exporting `captureLogs(context: TestContext)` that calls `setLogWriter` to collect lines, registers the restore in `context.after`, and returns `{ lines: string[]; events(): Record<string, unknown>[]; named(event: string): Record<string, unknown>[] }`

**Checkpoint**: logger and request context ready; no behavior change yet.

---

## Phase 3: User Story 1 - Every chat answer carries a request identifier (Priority: P1) 🎯 MVP

**Goal**: every `POST /chat` response has `X-Request-Id`, and every body has the same `requestId`.

**Independent Test**: successful and failing chat requests all return the header and a matching `requestId`; ids are unique; a client header is ignored.

### Tests for User Story 1

- [X] T008 [P] [US1] Write failing tests in `tests/http/chat-errors.test.ts` for `classifyChatError(error)`: `UnknownConversationError` → `{ status: 404, category: "unknown_conversation", message: error.message }`; `UnknownStrategyError` → 422 `"unknown_strategy"`; `ModelUnavailableError` → 503 `"model_unavailable"`; `RequestTimeoutError` → 504 `"timeout"`; a body-parser error (`Object.assign(new SyntaxError("x"), { type: "entity.parse.failed", status: 400 })`) → `{ status: 400, category: "invalid_request", message: "Invalid JSON body" }`; plain `Error("boom")` → 500 `"internal"` message `"boom"`; non-Error value → 500 message `"Internal server error"`
- [X] T009 [US1] Write failing tests in `tests/http/server.test.ts` (new block at the end): pass `createRequestId` to `chatServer(...)` where useful; 200 response has header `x-request-id` equal to body `requestId` and matching `z.uuid()`; header and `requestId` in body for 400 (schema, includes `issues`), 400 malformed JSON (`body: "{"`, body `{ error: "Invalid JSON body", requestId }`), 404 unknown conversation, 422 unknown strategy, 503 (`ModelUnavailableError` from a fake strategy), 504 (`timeoutMs: 10`), 500 (fake strategy throws `Error("boom")`); a request with header `X-Request-Id: client-id` gets a different, server-made id; 100 sequential requests produce 100 distinct ids

### Implementation for User Story 1

- [X] T010 [US1] Create `src/http/chat-errors.ts` exporting `classifyChatError(error: unknown): { status: number; category: ErrorCategory; message: string }` per research R3 (import `ErrorCategory` from `src/store/request-store.ts`). Makes T008 pass
- [X] T011 [US1] In `src/http/server.ts`: add `createRequestId?: () => string` to `ChatServerOptions` (default `randomUUID` from `node:crypto`); replace `app.use(express.json(...))` with: a `/chat` middleware mounted first that sets `res.locals.requestId`, `res.setHeader("X-Request-Id", id)` and never reads `req.headers["x-request-id"]`; then `express.json({ limit: "1mb" })`; add `requestId: z.uuid()` to `chatResponseSchema`; put `requestId` in the 200 body and in every error body (`{ error, requestId }`, plus `issues` for the 400 schema case) by replacing the `catch` branches with `const { status, message } = classifyChatError(error); res.status(status).json({ error: message, requestId })`; add a `/chat` error-handling middleware `(error, req, res, next)` after the route that answers body-parser errors through `classifyChatError` with `requestId`. Makes T009 pass
- [X] T012 [US1] Run `npm test`; fix existing `tests/http/server.test.ts` assertions that `deepEqual` whole error bodies (add `requestId: <any uuid>` or compare `error` only)

**Checkpoint**: US1 complete — ids on every `/chat` response.

---

## Phase 4: User Story 2 - Look up a past turn with its full ordered trace (Priority: P1)

**Goal**: one `requests` row + ordered `trace_events` rows per `/chat`, saved before the response; `GET /requests/:id` returns them.

**Independent Test**: after a fake-model turn, `GET /requests/<requestId>` returns the same metrics and the same trace in the same order; failed turns show status, category and partial trace; unknown → 404, malformed → 400; data survives reopening the DB.

### Tests for User Story 2

- [X] T013 [P] [US2] Write failing tests in `tests/store/sqlite-request-store.test.ts` for `SqliteRequestStore(":memory:")`: `record(record, trace)` then `get(id)` returns an equal record and the trace in order (positions 0..n-1, payload deep-equal, including `route` and `fallback` events with `node`); a record with `status: 503`, `errorCategory: "model_unavailable"`, `metrics: null` and `[]` trace round-trips; `get` of an unknown UUID → `undefined`; `get("not-a-uuid")` throws `DomainValidationError`; recording the same id twice throws and leaves the first record and trace intact (transaction rollback); records and traces of two requests do not mix; with a temp file path (`mkdtempSync` + `join(..., "requests.db")`), closing and reopening the store returns the same data; `buildRequestRecord({ id, startedAt: Date, finishedAt: Date, ... })` computes `durationMs = max(0, round(finished - started))` and validates with `requestRecordSchema`
- [X] T014 [P] [US2] Write failing tests in `tests/graph/production-graph.test.ts`: `graph.run(input, { onTrace })` calls `onTrace` with the growing trace after each node (last call deep-equals `output.trace`); when the answering strategy throws, the last observed trace contains the `summarize` (context) and `route` (router) events before the error propagates
- [X] T015 [US2] Write failing tests in `tests/http/server.test.ts` using `requestStore: new SqliteRequestStore(":memory:")`: after a 200 `/chat`, `GET /requests/<requestId>` → 200 with `request.status === 200`, `request.errorCategory === null`, `request.metrics` equal to the chat response's `llmCalls`/`latencyMs`/`promptTokens`/`historyMessages`/`modelUsed`, `request.conversationId` equal to the response's, and `trace` deep-equal to the chat response trace; after a 503 with an existing conversation (fake router + strategy throwing `ModelUnavailableError`), lookup shows `status: 503`, `errorCategory: "model_unavailable"`, `metrics: null` and a trace starting with the `route` event; a 400 schema error is recorded with `status: 400`, `errorCategory: "invalid_request"`, `trace: []`; `requestedRoute` is `"plan-and-execute"` when the body had `strategy: "plan-and-execute"`; `GET /requests/not-a-uuid` → 400 `{ error: "Invalid request id" }`; unknown UUID → 404 `{ error: "Unknown request: <id>" }`; a store whose `record` throws → chat still 200 with `requestId` and lookup on a working store is not attempted (assert response only)

### Implementation for User Story 2

- [X] T016 [US2] Create `src/store/sqlite-request-store.ts`: class `SqliteRequestStore implements RequestStore` with the constructor pattern of `SqliteConversationStore` (`path = process.env.OPSPILOT_DB ?? "./data/opspilot.db"`, `mkdirSync` for file paths, `PRAGMA foreign_keys = ON` checked, `PRAGMA busy_timeout = 2000`); schema exactly as in data-model.md (`requests` with the CHECK constraints `duration_ms >= 0`, `status BETWEEN 100 AND 599`, `error_category IN (...)`, `requested_route IN ('react','plan-and-execute','reflection')`, non-negative metric columns; index `requests_started_at`; `trace_events` with `PRIMARY KEY (request_id, position)`, `REFERENCES requests(id) ON DELETE CASCADE`, `payload TEXT NOT NULL`); `record()` validates with `requestRecordSchema` and `traceEventSchema`, runs `BEGIN`/`INSERT`s/`COMMIT` with `ROLLBACK` on error, stores metrics columns as `NULL` when `metrics` is null and each event as `JSON.stringify(event)` with `type`/`node` columns; `get(id)` validates `z.uuid()` (else `DomainValidationError("Invalid request id")`), reads the row and events `ORDER BY position`, parses with `requestRecordSchema`/`traceEventSchema`; `close()`. Also export pure `buildRequestRecord(...)` from `src/store/request-store.ts`. Makes T013 pass
- [X] T017 [US2] In `src/graph/production-graph.ts`: change `run(input)` to `run(input, options: { onTrace?: (trace: TraceEvent[]) => void } = {})` using `compiled.stream(initialState, { streamMode: "values" })`, calling `options.onTrace?.(state.trace)` for each streamed state and returning `requireState(lastState.output, "output")`. Makes T014 pass
- [X] T018 [US2] In `src/http/server.ts`: add `requestStore?: RequestStore` to `ChatServerOptions` (default `new SqliteRequestStore()`); in the `/chat` handler track `startedAt`, the parsed `conversationId`/`requestedRoute` (`null` when absent or invalid) and `lastTrace` via `graph.run(..., { onTrace: (t) => { lastTrace = t; } })`; in a single `finish(status, body, { category, metrics, trace })` helper: build the record with `buildRequestRecord`, call `requestStore.record(record, trace)` inside `try/catch` (on error: `logEvent("error", "persistence_failed", { errorCategory: "persistence" })`), then `res.status(status).json(body)`; 200 uses the validated response trace and metrics; errors use `lastTrace` (or `[]`). Use it from the body-parser error middleware too. Makes T015 (persistence parts) pass
- [X] T019 [US2] In `src/http/server.ts` add `GET /requests/:id`: `z.uuid()` check → 400 `{ error: "Invalid request id" }`; `requestStore.get(id)` → 404 `{ error: \`Unknown request: ${id}\` }` (via `UnknownRequestError` mapped at the edge); 200 body validated with `requestLookupResponseSchema = z.object({ request: requestRecordSchema, trace: z.array(traceEventSchema) }).strict()`; other errors → 500 `{ error: message }`. Makes T015 (lookup parts) pass
- [X] T020 [US2] In `startChatServer` (`src/http/server.ts`) create the `SqliteRequestStore` when not provided and close it on server `close` (same ownership pattern as the conversation store); update the `chatServer` helper in `tests/http/server.test.ts` to pass `requestStore: new SqliteRequestStore(":memory:")` by default and add `requestStore` to the four direct `createChatServer(...)` calls so no test touches the real DB file

**Checkpoint**: US1 + US2 complete — every turn can be looked up.

---

## Phase 5: User Story 3 - Structured, content-free logs for each request (Priority: P2)

**Goal**: one metadata-only JSON line per event on stderr; existing diagnostics migrated.

**Independent Test**: captured log lines for a fake turn are valid JSON, include `requestId`, contain `request_started`, one `trace_event` per trace event and `request_finished`, and no content.

### Tests for User Story 3

- [X] T021 [US3] Write failing tests in `tests/http/server.test.ts` using `captureLogs`: a 200 turn with N trace events logs exactly `request_started`, N `trace_event` lines (positions 0..N-1, with `type` and `node` matching the response trace) and one `request_finished` (`status: 200`, `durationMs`, `traceEvents: N`, `llmCalls`, `modelUsed`), all with the response `requestId`; a 503 turn logs `request_finished` with `level: "error"`, `status: 503`, `errorCategory: "model_unavailable"`; a 404 logs `level: "warn"`; a failing store logs `persistence_failed`; no captured line contains the user message, the answer text, or the keys `content`, `reason`, `answer`, `args`, `message`
- [X] T022 [P] [US3] Replace `console.error` mocks with `captureLogs` in `tests/graph/router.test.ts` (2 `router_fallback` lines, `level: "warn"`, `node: "router"`, `route: "react"`, no reason text), `tests/graph/production-graph.test.ts` (router fallback test → 2 `router_fallback`; strategy fallback tests → 1 `strategy_fallback` with `node` = failing strategy and `route: "react"`; other tests just capture), `tests/context/conversation-history.test.ts` (`summarization_failed` with `node: "context"` and `conversationId`), `tests/llm/model.test.ts` (1 `model_fallback` with `primaryModel: "p/one"`, `reserveModel: "r/two"`, no reason) and the `console.error` mocks in `tests/http/server.test.ts`

### Implementation for User Story 3

- [X] T023 [US3] In `src/http/server.ts`: wrap each `/chat` request in `runWithRequestContext({ requestId }, ...)` (start it in the request-id middleware with `next` called inside the scope); log `request_started` (info) in the middleware; in `finish(...)` after persistence log one `trace_event` (info) per stored event with `position`, `type`, `node`, then `request_finished` with level `info` for 2xx, `warn` for 4xx, `error` for 5xx and fields `status`, `durationMs`, `traceEvents`, `errorCategory` (if any), `llmCalls`/`promptTokens`/`modelUsed` (200 only), `conversationId` (if known); replace the learning-reflection `console.error` with `logEvent("warn", "learning_reflection_failed")` (capture the request id before the async call so the line still has it). Makes T021 pass
- [X] T024 [P] [US3] Replace `console.error(reason)` in `src/graph/router.ts` (`decideRoute` catch) with `logEvent("warn", "router_fallback", { node: "router", route: "react" })`
- [X] T025 [P] [US3] Replace `console.error(reason)` in `src/graph/production-graph.ts` (strategy node catch) with `logEvent("warn", "strategy_fallback", { node: STRATEGY_NODES[route], route: "react" })`
- [X] T026 [P] [US3] Replace `console.error(...)` in `src/llm/model.ts` (reserve step) with `logEvent("warn", "model_fallback", { primaryModel, reserveModel })`
- [X] T027 [P] [US3] Replace `console.error(...)` in `src/context/conversation-history.ts` with `logEvent("warn", "summarization_failed", { node: "context", conversationId })`. T024–T027 make T022 pass

**Checkpoint**: all stories complete.

---

## Phase 6: Polish & Cross-Cutting

- [X] T028 [P] Update `README.md` with a "Rastreamento e logs" section: `X-Request-Id`/`requestId`, `GET /requests/:id`, tables `requests`/`trace_events` in `OPSPILOT_DB`, JSON logs on stderr with the event list, linking both contracts in `specs/015-request-trace-logs/contracts/`
- [X] T029 [P] Grep `src/` for remaining `console.error`/`console.warn` inside request paths (`src/http`, `src/graph`, `src/llm`, `src/context`); only startup messages in `src/http/server.ts`/`src/index.ts` and CLI output in `src/arena.ts`, `src/bench.ts`, `src/mcp/server.ts` may remain
- [X] T030 Run `npm run typecheck` and `npm test`; both green for this feature (report any failure in files this feature does not touch)
- [ ] T031 Run the live checks 2–3 from `specs/015-request-trace-logs/quickstart.md`

---

## Dependencies & Execution Order

- **Setup (T001–T002)**: no dependencies, `[P]`.
- **Foundational (T003–T007)**: after Setup (logger imports `errorCategorySchema` from T002). T003→T004, T005→T006; T007 after T006. Blocks all stories.
- **US1 (T008–T012)**: after Foundational. T008 `[P]` with T009; T010 → T011 → T012.
- **US2 (T013–T020)**: after US1 (needs `requestId` and `classifyChatError` in the server). T013, T014 `[P]`; T016 after T013; T017 after T014; T018 → T019 → T020 (same file).
- **US3 (T021–T027)**: after US2 (logs trace events from the persisted trace in `finish`). T024–T027 `[P]` (different files); T022 test edits in parallel with them.
- **Polish (T028–T031)**: after all stories.

Story order: US1 → US2 → US3.

## Parallel Examples

```text
# Setup
T001, T002

# Foundational tests
T003 (request-context.test.ts), T005 (logger.test.ts)

# US1
T008 (chat-errors.test.ts) with T009 (server.test.ts)

# US2 tests
T013 (sqlite-request-store.test.ts), T014 (production-graph.test.ts)

# US3 call-site migrations
T024 (router.ts), T025 (production-graph.ts), T026 (model.ts), T027 (conversation-history.ts)
```

## Implementation Strategy

1. **MVP = Setup + Foundational + US1**: every response carries a request id. Validate with `npm test`.
2. **+ US2**: persist and look up turns (quickstart check 2, lookup part; check 3).
3. **+ US3**: JSON logs and diagnostic migration (quickstart check 2, logs part).
4. Polish: README, console audit, full green run, live checks.
