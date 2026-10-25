# Research: Persisted Request Trace and JSON Logs

Checked against the current code (features 001–014) and the installed `node:sqlite`, Express 5
and LangGraph 1.4.18.

## R1. Where the request id is created

- **Decision**: an Express middleware mounted on `/chat` **before** `express.json()` sets
  `res.locals.requestId = createRequestId()` (default `randomUUID`, injectable) and
  `res.setHeader("X-Request-Id", id)`. A client `X-Request-Id` is never read. The rest of the
  request runs inside `runWithRequestContext({ requestId }, …)`.
- **Rationale**: body parsing errors happen before the route handler; setting the header first
  guarantees it on every `/chat` response (FR-002). Server-only ids avoid client-controlled
  primary keys (FR-003).
- **Alternatives considered**: generating the id inside the handler (misses malformed JSON);
  honoring the client header (collisions, spoofing of stored records).

## R2. Malformed JSON on `/chat`

- **Decision**: a `/chat`-scoped error handler after the route catches body-parser errors
  (`type === "entity.parse.failed"` / `status 400`) and replies `400 { error: "Invalid JSON body",
  requestId }`, recording the request with category `invalid_request`.
- **Rationale**: today Express answers with its default HTML page, which cannot carry
  `requestId` in the body; JSON keeps the API consistent. Behavior change limited to this case.

## R3. Error mapping as a pure function

- **Decision**: `classifyChatError(error): { status, category, message }` in
  `src/http/chat-errors.ts`:

  | Error | status | category |
  |-------|--------|----------|
  | Zod body validation (handled before) / JSON parse | 400 | `invalid_request` |
  | `UnknownConversationError` | 404 | `unknown_conversation` |
  | `UnknownStrategyError` | 422 | `unknown_strategy` |
  | `ModelUnavailableError` | 503 | `model_unavailable` |
  | `RequestTimeoutError` | 504 | `timeout` |
  | anything else | 500 | `internal` |

  The 500 message stays as today (`error.message`). The handler sends
  `{ error: message, requestId }` (plus `issues` for 400 validation).
- **Rationale**: one table drives the status, the stored `error_category` and the log line;
  pure and unit-testable; status codes unchanged (FR-014).

## R4. Partial trace for failed turns

- **Decision**: `graph.run(input, { onTrace?: (trace) => void })` switches from
  `compiled.invoke` to `compiled.stream(input, { streamMode: "values" })` and calls `onTrace`
  with `state.trace` after every node. The handler keeps the latest value; on success it uses
  `output.trace` (identical to the last observed one), on failure the last observed trace.
- **Rationale**: graph state is lost when a node throws; streaming full state values after
  each node is LangGraph's built-in way to observe progress without changing nodes. The trace
  of the failing node itself is lost (it never committed), but events of completed nodes —
  including `summarize`, `route` and `fallback` events — are kept (FR-007).
- **Timeout**: `withRequestTimeout` still races the graph; the record stores the trace
  observed at the moment of the 504. The graph keeps running in the background (unchanged).
- **Alternatives considered**: a mutable sink pushed by each node (touches every node);
  catching inside nodes (would alter fallback semantics from features 013/014).

## R5. Store: one transaction before the response

- **Decision**: `SqliteRequestStore` (same constructor pattern as `SqliteConversationStore`:
  `path = process.env.OPSPILOT_DB ?? "./data/opspilot.db"`, `PRAGMA foreign_keys = ON`,
  `CREATE TABLE IF NOT EXISTS`) with `record(record, trace)` running
  `BEGIN` → one `INSERT INTO requests` → one `INSERT INTO trace_events` per event → `COMMIT`
  (rollback on error), and `get(id): { record, trace } | undefined`. The handler calls
  `record` synchronously right before `res.json(...)`, inside `try/catch` → `persistence_failed`
  log. `PRAGMA busy_timeout = 2000` because several connections share the file.
- **Rationale**: `node:sqlite` is synchronous, so the write finishes before the response
  (FR-006); a transaction prevents a record without its events; the failure path keeps the chat
  answer (FR-008).
- **Payload**: each event is stored as `JSON.stringify(event)` exactly as it appears in the
  validated chat response (already `sanitizeTraceEvent`-ed); `type` and `node` are copied to
  columns for querying. On read each payload is parsed with `traceEventSchema`.
- **Alternatives considered**: write after the response (`res.on("finish")`) — lookup right
  after the response could miss it; a single JSON blob column for the whole trace — loses
  per-event querying the user asked for (`trace_events`).

## R6. Logger destination and shape

- **Decision**: `src/obs/logger.ts` writes `JSON.stringify(event) + "\n"` to **stderr** through a
  replaceable writer (`setLogWriter(fn)` returns a restore function, for tests). Events are
  validated with a strict `logEventSchema` (unknown keys rejected); the logger drops invalid
  fields instead of throwing (it must never break a request) and adds `ts` (ISO) and the
  current `requestId` from the request context.
- **Rationale**: the MCP server uses stdio — stdout carries the MCP protocol — and it uses the
  same model factory whose fallback now logs, so stdout logging would corrupt MCP sessions.
  stderr also keeps arena/bench stdout output clean. (Spec assumption updated accordingly.)
- **Alternatives considered**: stdout (breaks MCP); a logging library such as pino (new
  dependency for one function).

## R7. Which events are logged

| event | level | when | metadata |
|-------|-------|------|----------|
| `request_started` | info | middleware | requestId |
| `trace_event` | info | per stored event, at the end of the request | node, type, seq |
| `request_finished` | info / warn (4xx) / error (5xx) | after persistence | status, durationMs, errorCategory, llmCalls, promptTokens, modelUsed, conversationId, traceEvents |
| `persistence_failed` | error | store threw | errorCategory: `persistence` |
| `router_fallback` | warn | `decideRoute` catch (replaces `console.error`) | node: `router`, route |
| `strategy_fallback` | warn | strategy node catch | node, route |
| `model_fallback` | warn | factory reserve switch | primaryModel, reserveModel |
| `summarization_failed` | warn | history summarizer catch | node: `context`, conversationId |
| `learning_reflection_failed` | warn | post-response reflector | (none beyond requestId) |

Reasons, error messages, user ids and content are deliberately not logged; reasons stay in
the stored trace (`route`/`fallback`/`summarize` events). `trace_event` lines are emitted after
the turn (not live) so their `seq` matches the stored rows. FR-012's metadata list is
extended with `route`, `primaryModel`, `reserveModel` and `traceEvents` (ids/counts, no content).

## R8. Request context

- **Decision**: `src/obs/request-context.ts` — `AsyncLocalStorage<{ requestId: string }>`,
  `runWithRequestContext(ctx, fn)`, `currentRequestId(): string | undefined`. The logger reads
  it; arena/bench/MCP have no context, so their lines omit `requestId`.
- **Rationale**: the router, graph and model factory are shared across turns; threading a
  request id through every signature would touch many modules. Same pattern as feature 014's
  fallback recorder.

## R9. Tests and existing console mocks

- **Decision**: tests that currently mock `console.error` and count calls (graph, router,
  model fallback) switch to a `captureLogs()` helper (`tests/helpers/capture-logs.ts`) built on
  `setLogWriter`. `tests/http/server.test.ts`'s `chatServer` helper adds
  `requestStore: new SqliteRequestStore(":memory:")` so no test writes the real DB file.
- **Rationale**: keeps assertions on "one diagnostic per fallback" while checking the new
  metadata-only shape.
