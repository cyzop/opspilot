# Contract: JSON log lines (`src/obs/logger.ts`)

- Destination: **stderr** (stdout is reserved for the MCP stdio protocol and CLI output).
- One JSON object per line, `\n`-terminated, no pretty printing.
- Only the fields below; anything else is dropped. Never: message text, answers, trace
  content, reasons, tool arguments, error messages, user ids, secrets.

## Fields

| Field | Type | Notes |
|-------|------|-------|
| `ts` | string | ISO 8601, always |
| `level` | `info` \| `warn` \| `error` | always |
| `event` | see table below | always |
| `requestId` | UUID | when inside a `/chat` request |
| `node` | graph node | trace/diagnostic events |
| `type` | trace event type | `trace_event` |
| `seq` | int ≥ 0 | `trace_event` |
| `route` | `react` \| `plan-and-execute` \| `reflection` | fallbacks |
| `status` | int | `request_finished` |
| `route` (finish) | strategy that answered | `request_finished` |
| `durationMs` | int ≥ 0 | `request_finished` |
| `errorCategory` | category or `persistence` | failures |
| `traceEvents` | int ≥ 0 | `request_finished` |
| `llmCalls`, `promptTokens` | int ≥ 0 / null | `request_finished` (200 only) |
| `modelUsed`, `primaryModel`, `reserveModel` | model ids | metrics / `model_fallback` |
| `conversationId` | string | when known |

## Events

| event | level |
|-------|-------|
| `request_started` | info |
| `trace_event` | info |
| `request_finished` | info (2xx), warn (4xx), error (5xx) |
| `persistence_failed` | error |
| `router_fallback`, `strategy_fallback`, `model_fallback`, `summarization_failed`, `learning_reflection_failed` | warn |

## Example (one turn, two trace events)

```text
{"ts":"2026-10-24T13:05:11.204Z","level":"info","event":"request_started","requestId":"6f1c…1e73"}
{"ts":"2026-10-24T13:05:13.077Z","level":"info","event":"trace_event","requestId":"6f1c…1e73","seq":0,"type":"route","node":"router"}
{"ts":"2026-10-24T13:05:13.077Z","level":"info","event":"trace_event","requestId":"6f1c…1e73","seq":1,"type":"answer","node":"react"}
{"ts":"2026-10-24T13:05:13.078Z","level":"info","event":"request_finished","requestId":"6f1c…1e73","status":200,"durationMs":1874,"traceEvents":2,"llmCalls":2,"promptTokens":512,"modelUsed":"openrouter/free","conversationId":"…"}
```
