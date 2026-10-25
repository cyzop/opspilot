# Data Model: Persisted Request Trace and JSON Logs

## SQLite tables (`src/store/sqlite-request-store.ts`)

```sql
CREATE TABLE IF NOT EXISTS requests (
  id               TEXT PRIMARY KEY NOT NULL,          -- UUID
  started_at       TEXT NOT NULL,                      -- ISO 8601
  duration_ms      INTEGER NOT NULL CHECK (duration_ms >= 0),
  status           INTEGER NOT NULL CHECK (status BETWEEN 100 AND 599),
  error_category   TEXT CHECK (error_category IN
                     ('invalid_request','unknown_conversation','unknown_strategy',
                      'model_unavailable','timeout','internal')),
  conversation_id  TEXT,                               -- no FK: may be an unknown id (404)
  user_id          TEXT,                               -- memory user, when sent
  requested_route  TEXT CHECK (requested_route IN ('react','plan-and-execute','reflection')),
  route            TEXT CHECK (route IN ('react','plan-and-execute','reflection')), -- strategy that answered
  llm_calls        INTEGER CHECK (llm_calls >= 0),
  latency_ms       REAL CHECK (latency_ms >= 0),
  prompt_tokens    INTEGER CHECK (prompt_tokens >= 0),
  history_messages INTEGER CHECK (history_messages >= 0),
  model_used       TEXT
);

CREATE INDEX IF NOT EXISTS requests_started_at ON requests(started_at);

CREATE TABLE IF NOT EXISTS trace_events (
  request_id TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  seq   INTEGER NOT NULL CHECK (seq >= 0),
  type       TEXT NOT NULL,
  node       TEXT,
  payload    TEXT NOT NULL,                            -- JSON of the redacted TraceEvent
  PRIMARY KEY (request_id, seq)
);
```

Metric columns are `NULL` when the turn did not complete (any non-200 status).

## RequestRecord (`src/store/request-store.ts`)

Zod `requestRecordSchema` (strict), camelCase:

| Field | Type | Rules |
|-------|------|-------|
| `id` | string | `z.uuid()` |
| `startedAt` | string | ISO datetime |
| `durationMs` | int ≥ 0 | |
| `status` | int | 100–599 |
| `errorCategory` | enum \| null | `invalid_request`, `unknown_conversation`, `unknown_strategy`, `model_unavailable`, `timeout`, `internal`; `null` iff status 200 |
| `conversationId` | string \| null | |
| `userId` | string \| null | memory user from the body |
| `requestedRoute` | `react` \| `plan-and-execute` \| `reflection` \| null | override parsed from the body |
| `route` | same enum \| null | strategy that answered: last `route` event of the trace (`chosenRoute`) |
| `metrics` | object \| null | `{ llmCalls, latencyMs, promptTokens (nullable), historyMessages, modelUsed }`; non-null iff status 200 |

`buildRequestRecord({ id, startedAt, finishedAt, status, errorCategory, conversationId,
requestedRoute, metrics })` is pure and computes `durationMs`.

## StoredTraceEvent

| Field | Source | Rules |
|-------|--------|-------|
| `requestId` | record id | FK |
| `seq` | index in the response trace | 0-based, contiguous |
| `type` | `event.type` | trace event type |
| `node` | `event.node` | graph node or `null` |
| `payload` | `JSON.stringify(event)` | parsed back with `traceEventSchema` |

## RequestStore interface

```ts
interface RequestStore {
  record(record: RequestRecord, trace: readonly TraceEvent[]): void; // one transaction
  get(id: string): { record: RequestRecord; trace: TraceEvent[] } | undefined;
  close(): void;
}
```

`get` validates `id` with `z.uuid()` (throws `DomainValidationError`), orders by `seq`.

## ChatErrorClassification (`src/http/chat-errors.ts`)

`classifyChatError(error) → { status, category, message }` — table in research R3.

## LogEvent (`src/obs/logger.ts`)

Strict Zod `logEventSchema` — any other key is dropped:

| Field | Type |
|-------|------|
| `ts` | ISO string (added by the logger) |
| `level` | `info` \| `warn` \| `error` |
| `event` | `request_started` \| `trace_event` \| `request_finished` \| `persistence_failed` \| `router_fallback` \| `strategy_fallback` \| `model_fallback` \| `summarization_failed` \| `learning_reflection_failed` |
| `requestId` | UUID, optional (from request context) |
| `node`, `type`, `seq`, `route` | optional trace metadata |
| `status`, `durationMs`, `errorCategory`, `traceEvents` | optional request metadata (`errorCategory` also allows `persistence`) |
| `llmCalls`, `promptTokens`, `modelUsed`, `primaryModel`, `reserveModel`, `conversationId` | optional metrics/ids |

`formatLogLine(event)` (pure) → one `JSON.stringify` line with no newlines inside.

## Request lifecycle

```text
middleware: id + header + request_started
   └─ handler (inside request context)
        ├─ 400 validation ─────────────────────────────┐
        ├─ graph.run(onTrace) ─ ok ─▶ chat response    │
        │                    └ throws ─▶ classify ─────┤
        ▼                                              ▼
   store.record(record, trace)  (try → persistence_failed on error)
   log trace_event × N, request_finished
   res.status(...).json({ ..., requestId })
```
