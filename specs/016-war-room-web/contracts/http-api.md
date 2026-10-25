# Contract: HTTP API changes

All new and changed responses carry `X-Request-Id` and `requestId`. Bodies are validated with
Zod on the server before sending and on the web before use.

## `POST /chat` — new 202 outcome

Unchanged: request body, 200 body, 4xx/5xx bodies.

**202 Accepted** — the turn paused before `resolve_incident`:

```json
{
  "status": "pending_approval",
  "requestId": "8d0c…",
  "conversationId": "c-…",
  "approval": {
    "id": "5b7e…",
    "tool": "resolve_incident",
    "args": { "id": "incident-001" },
    "target": "incident-001",
    "description": "Resolver o incidente incident-001",
    "status": "pending",
    "createdAt": "2026-10-24T13:05:11.204Z",
    "expiresAt": "2026-10-24T13:20:11.204Z",
    "decidedAt": null
  },
  "trace": [
    { "type": "route", "node": "router", "...": "..." },
    { "type": "thought", "node": "react", "content": "The model selected an operational tool." },
    { "type": "action", "node": "react", "content": "Requested tool resolve_incident", "tool": "resolve_incident", "args": { "id": "incident-001" } },
    { "type": "approval", "node": "react", "content": "Aguardando aprovação: Resolver o incidente incident-001", "approvalId": "5b7e…", "decision": "pending", "tool": "resolve_incident", "target": "incident-001" }
  ],
  "metrics": { "llmCalls": 1, "latencyMs": 812, "promptTokens": 950, "historyMessages": 0, "modelUsed": "openrouter/free" }
}
```

The 200 body never has `status`; clients tell 200 and 202 apart by HTTP status.

## `GET /approvals/:id`

| Status | Body |
|--------|------|
| 200 | `{ "approval": Approval, "requestId": "…" }` (`status` may be `expired`) |
| 400 | `{ "error": "Invalid approval id", "requestId" }` |
| 404 | `{ "error": "Unknown approval", "requestId" }` |

## `POST /approvals/:id/decision`

Body (strict): `{ "decision": "approve" | "deny" }`

| Status | Body |
|--------|------|
| 200 | `{ "approval": Approval, "answer": string, "trace": TraceEvent[], "conversationId", "requestId", "metrics": { "llmCalls": 0, "latencyMs", "promptTokens": null, "historyMessages", "modelUsed" } }` |
| 400 | invalid id or body: `{ "error", "issues"?, "requestId" }` |
| 404 | unknown approval |
| 409 | `{ "error": "Approval is no longer pending", "approval": Approval, "requestId" }` |

Approve trace: `approval(approved)`, `action`, `observation`, `answer`. Deny trace:
`approval(denied)`, `answer`. All events tagged `node: "response"`.

Side effects: approve runs `resolveIncident(args.id)` exactly once; both outcomes append the
final assistant message to the conversation and record a request (status 200).

## CORS (all routes)

| Request | Response |
|---------|----------|
| `Origin` in allow-list | `Access-Control-Allow-Origin: <origin>`, `Vary: Origin`, `Access-Control-Expose-Headers: X-Request-Id` |
| `OPTIONS` preflight from allowed origin | `204`, plus `Access-Control-Allow-Methods: GET, POST, OPTIONS`, `Access-Control-Allow-Headers: Content-Type`, `Access-Control-Max-Age: 600` |
| `Origin` not allowed | no `Access-Control-*` headers (preflight: `204` without them; browser blocks) |
| No `Origin` | unchanged (curl, server-to-server) |

Config: `OPSPILOT_CORS_ORIGINS` (default `http://localhost:5173`); `*` → startup
`ConfigurationError`.

## Request records and stats

- A paused `/chat` turn is stored in `requests` with status `202`, `errorCategory: null` and its
  metrics; its trace ends with an `approval` event (`decision: "pending"`).
- A decision is its own request: status `200` (or `400`/`404`/`409` with category
  `invalid_request`), route `null`, `llmCalls: 0`; its trace starts with an `approval` event
  (`approved` or `denied`, `node: "response"`).
- `GET /stats` counts only status `>= 400` as errors, so `202` is not an error.
