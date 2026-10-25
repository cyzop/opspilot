# Contract: request ids on `POST /chat` and `GET /requests/:id`

## `POST /chat` — additions only

Every response, any status, has the header:

```text
X-Request-Id: 6f1c2a9e-3b7d-4c51-9a0e-2f8d4b6c1e73
```

A client-sent `X-Request-Id` is ignored.

### 200

Same body as feature 014 plus `requestId`:

```json
{
  "requestId": "6f1c2a9e-3b7d-4c51-9a0e-2f8d4b6c1e73",
  "answer": "…",
  "trace": [ { "type": "route", "node": "router", "…": "…" }, { "type": "answer", "node": "react", "content": "…" } ],
  "conversationId": "…",
  "metrics": { "llmCalls": 2, "latencyMs": 1830, "promptTokens": 512, "historyMessages": 0, "modelUsed": "openrouter/free", "…": "…" }
}
```

### Errors

Same status codes as before; every error body gains `requestId`:

| Status | Body |
|--------|------|
| 400 (schema) | `{ "error": "Invalid request body", "issues": [...], "requestId": "…" }` |
| 400 (malformed JSON) | `{ "error": "Invalid JSON body", "requestId": "…" }` — previously Express's HTML page |
| 404 | `{ "error": "Unknown conversation: …", "requestId": "…" }` |
| 422 | `{ "error": "Unknown strategy: …", "requestId": "…" }` |
| 503 | `{ "error": "Language models are unavailable; try again later.", "requestId": "…" }` |
| 504 | `{ "error": "Request timed out after 180s", "requestId": "…" }` |
| 500 | `{ "error": "<message>", "requestId": "…" }` |

## `GET /requests/:id`

### 200

```json
{
  "request": {
    "id": "6f1c2a9e-3b7d-4c51-9a0e-2f8d4b6c1e73",
    "startedAt": "2026-10-24T13:05:11.204Z",
    "durationMs": 1874,
    "status": 200,
    "errorCategory": null,
    "conversationId": "…",
    "userId": null,
    "requestedRoute": null,
    "route": "react",
    "metrics": { "llmCalls": 2, "latencyMs": 1830, "promptTokens": 512, "historyMessages": 0, "modelUsed": "openrouter/free" }
  },
  "trace": [
    { "type": "route", "node": "router", "route": "react", "source": "router", "reason": "…", "content": "…" },
    { "type": "answer", "node": "react", "content": "…" }
  ]
}
```

- `trace` equals the `trace` of the original `/chat` response, same order.
- Failed turn: `status` = the error status, `errorCategory` set, `metrics: null`, `trace` = events
  of completed graph steps (may be `[]`).

### Errors

| Status | When | Body |
|--------|------|------|
| 400 | `:id` is not a UUID | `{ "error": "Invalid request id" }` |
| 404 | never issued or not stored | `{ "error": "Unknown request: <id>" }` |
| 500 | storage read failed | `{ "error": "<message>" }` |
