# Feature Specification: Persisted Request Trace and JSON Logs

**Feature Branch**: `015-request-trace-logs`

**Created**: 2026-10-24

**Status**: Draft

**Input**: User description: "Trace persistido + logs JSON: /chat: requestId no corpo e no header X-Request-Id. SQLite: requests (métricas) e trace_events (node, payloads). src/obs/logger.ts: 1 linha JSON por evento, só metadados. GET /requests/:id registro + trace ordenado."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Every chat answer carries a request identifier (Priority: P1)

As an on-call operator or API client, I want every chat response to carry a unique request identifier, both in the response body and in an `X-Request-Id` response header, so that I can quote it when something looks wrong and find exactly that turn later.

**Why this priority**: The identifier is the key that links the answer, the stored record and the logs. Nothing else in this feature is usable without it.

**Independent Test**: Send several chat requests (successful and failing) and verify each response has an `X-Request-Id` header, successful bodies have a matching `requestId`, and no two requests share an identifier.

**Acceptance Scenarios**:

1. **Given** a valid chat request, **When** the turn succeeds, **Then** the response body contains `requestId` and the `X-Request-Id` header has the same value.
2. **Given** a chat request that fails (invalid body, unknown conversation, unknown strategy, models unavailable, timeout or unexpected error), **When** the error response is returned, **Then** it still carries the `X-Request-Id` header and the error body includes the same `requestId`.
3. **Given** many chat requests, **When** their identifiers are compared, **Then** they are all different.

---

### User Story 2 - Look up a past turn with its full ordered trace (Priority: P1)

As an operator investigating an answer, I want to fetch a past chat request by its identifier and get its stored record (outcome and metrics) together with its trace events in the original order, so that I can see what the agent did without reproducing the turn.

**Why this priority**: Today the trace only exists in the original response; once that response is gone, the reasoning is lost. Persisting and retrieving it is the core value.

**Independent Test**: With fake models, run a chat turn, take its `requestId`, fetch `GET /requests/<requestId>` and verify the record's metrics match the original response and the trace equals the original response trace, event by event, in the same order and with the same graph node on each event.

**Acceptance Scenarios**:

1. **Given** a completed chat turn, **When** the operator requests `GET /requests/<requestId>` right after the response, **Then** the response contains the request record (time, outcome status, conversation, metrics such as model calls, latency, prompt tokens, history messages and model used) and the trace events ordered as in the original response.
2. **Given** a chat turn that failed after the graph started (for example models unavailable or timeout), **When** its identifier is looked up, **Then** the record shows the failure status and error category, and the trace contains whatever events were produced before the failure (possibly none).
3. **Given** an identifier that was never issued, **When** it is looked up, **Then** the response is "not found".
4. **Given** a malformed identifier, **When** it is looked up, **Then** the response is "invalid request" without touching stored data.
5. **Given** the service is restarted, **When** an earlier identifier is looked up, **Then** the record and trace are still returned.

---

### User Story 3 - Structured, content-free logs for each request (Priority: P2)

As an operator running OpsPilot, I want the chat server to write exactly one JSON line per observable event (request received, each trace event, request finished, persistence problems), containing only metadata and never user messages, answers or tool payloads, so that logs can be searched and shipped safely.

**Why this priority**: Logs give a real-time view and work even when nobody queries the stored trace, but they depend on the request identifier (Story 1) and the event model (Story 2).

**Independent Test**: Capture the server's log output during a fake-model chat turn and verify every line parses as a JSON object, each line includes the request identifier, there is one line per trace event plus the start and finish lines, and no line contains the user message, the answer, tool arguments or any trace content.

**Acceptance Scenarios**:

1. **Given** a successful chat turn with N trace events, **When** the log output is captured, **Then** it contains a "request started" line, N trace-event lines and a "request finished" line, each a single JSON object with the request identifier.
2. **Given** any log line, **When** it is inspected, **Then** it contains only metadata (time, level, event name, request identifier, and where relevant graph node, event type, seq, status, duration, counts, model used, error category) and no message text, answer text, trace content, reasons, tool arguments or secrets.
3. **Given** a failing chat turn, **When** the log output is captured, **Then** the "request finished" line carries the failure status and error category.
4. **Given** the existing diagnostic messages printed during a chat turn (router fallback, strategy fallback, model fallback), **When** they happen, **Then** they are emitted as structured metadata-only lines; their detailed reasons remain available in the stored trace.

---

### Edge Cases

- Persisting the record or trace fails (for example the database is locked): the chat response is still returned to the client with its `requestId`, and a "persistence failed" log line is written; the lookup later returns "not found".
- A client sends its own `X-Request-Id` header: it is ignored and the server issues its own identifier (no client-controlled keys in storage).
- Invalid chat bodies (400) are recorded with status 400 and no trace, so every issued identifier can be looked up.
- A very long trace (many tool calls): all events are stored and returned in order; lookup does not truncate.
- Trace payloads are stored as they appear in the chat response, which is already redacted with the project's secret patterns; nothing unredacted is stored.
- Learning reflection that runs after the response is not part of the request trace.
- Arena, bench and the MCP server do not go through `/chat` and are not recorded.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST assign a new, unique request identifier to every `POST /chat` request before processing it.
- **FR-002**: Every `POST /chat` response, success or error, MUST include the identifier in an `X-Request-Id` header; successful bodies MUST include `requestId`, and error bodies MUST include `requestId` next to `error`.
- **FR-003**: The system MUST ignore any client-supplied `X-Request-Id` and always use its own identifier.
- **FR-004**: The system MUST persist one request record per `POST /chat` request with: identifier, start time, duration, HTTP status, error category (if any), conversation identifier (if any), requested strategy override (if any), and the turn metrics (model calls, latency, prompt tokens, history messages, model used) when the turn completed.
- **FR-005**: The system MUST persist each trace event of a request as its own entry with: request identifier, seq (0-based, in response order), event type, graph node, and the full event payload exactly as returned to the client.
- **FR-006**: For a successful turn, the record and all trace events MUST be stored before the response is sent, so a lookup right after the response succeeds.
- **FR-007**: For a turn that fails after the graph has started, the system MUST persist the record with the failure status and any trace events produced before the failure.
- **FR-008**: A failure to persist MUST NOT change the chat response; it MUST be reported as a metadata-only log line.
- **FR-009**: `GET /requests/:id` MUST return the stored request record and its trace events ordered by seq; unknown identifiers return 404 and malformed identifiers return 400, both with an `error` message.
- **FR-010**: The lookup response MUST be validated against a defined contract before it is sent, and trace events in it MUST match the trace event schema used by `/chat`.
- **FR-011**: The chat server MUST write exactly one JSON object per line for each observable event: request started, each trace event, request finished, persistence failed, and the existing router/strategy/model fallback diagnostics.
- **FR-012**: Log lines MUST contain only metadata: timestamp, level, event name, request identifier, and where applicable graph node, event type, event seq, HTTP status, duration, model call count, prompt tokens, model used, primary/reserve model identifiers, chosen route, trace event count, conversation identifier and error category; they MUST NOT contain message text, answers, trace content, reasons, tool arguments, error messages or secrets.
- **FR-013**: Stored data MUST survive a service restart and live in the project's existing local database; tests MUST use an isolated in-memory database.
- **FR-014**: Existing `/chat` behavior (status codes, body fields, persistence of the conversation exchange, timeouts) MUST be unchanged apart from the added `requestId` field and header.
- **FR-015**: Automated tests MUST cover: identifier in body and header for success and each error status; uniqueness; client header ignored; record and ordered trace returned by lookup and equal to the original response; failed turn recorded with status and partial trace; 404 and 400 lookups; persistence failure does not break the chat; one JSON line per event with no content fields; data survives reopening the database.

### Key Entities

- **Request Record**: one chat request — identifier, start time, duration, HTTP status, error category, conversation identifier, requested strategy, turn metrics (model calls, latency, prompt tokens, history messages, model used).
- **Stored Trace Event**: one trace event of a request — request identifier, seq, event type, graph node, full redacted payload.
- **Log Event**: one JSON line — timestamp, level, event name, request identifier and metadata fields only.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of chat responses, including errors, carry a request identifier, and no identifier repeats across 1,000 consecutive requests.
- **SC-002**: For 100% of completed turns, looking up the identifier immediately after the response returns the same metrics and the same trace, event by event and in the same order, as the original response.
- **SC-003**: Stored requests remain retrievable after a service restart.
- **SC-004**: 100% of log lines produced during chat turns are valid single-line JSON objects, and 0 lines contain user messages, answers, trace content or secrets.
- **SC-005**: An operator can go from a quoted identifier to the full reasoning of that turn with a single lookup.
- **SC-006**: A failure to store observability data never turns a successful chat answer into an error.

## Assumptions

- The user named the `X-Request-Id` header, the `requestId` body field, the `requests` and `trace_events` storage, a dedicated logger module (`src/obs/logger.ts`) and `GET /requests/:id`; the plan will honor them.
- Storage reuses the existing local SQLite database configured by `OPSPILOT_DB` (default `./data/opspilot.db`), with `:memory:` in tests, as required by the constitution.
- Identifiers are random UUIDs generated by the server; malformed means "not a UUID".
- Logs go to standard error as JSON lines (standard output is reserved for the MCP server's stdio protocol, which shares the model factory); log levels are `info` for normal events and `warn`/`error` for fallbacks and failures. No log shipping, rotation or retention is in scope.
- Stored records are kept indefinitely; retention and cleanup are out of scope.
- `GET /requests/:id` has no authentication, like the rest of the local API.
- Stored trace payloads are the already-redacted events returned to the client; the request record does not duplicate the user message or the answer (those live in the conversation store and in the `answer` trace event).
- Only `/chat` requests are recorded; `/memories` and other routes are out of scope.
