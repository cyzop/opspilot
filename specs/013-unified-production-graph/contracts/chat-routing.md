# Contract: `POST /chat` with the unified production graph

## Request

```json
{ "message": "Triagem dos alertas de pagamentos", "conversationId": "…", "userId": "u-42" }
```

`strategy` is optional (no default). Accepted values: `react`, `plan-and-execute`,
`reflection`, `reflect:react`, `reflect:plan-and-execute`. `reflect: true` → `reflection`.
Unknown value → **422** `{ "error": "Unknown strategy: <value>" }`, nothing runs.

## Flow

`context → router → (react | plan-and-execute | reflection) → response`

## 200 response — trace

Every event has `node`. Order: `summarize` (if any) → `route` → strategy events.

```json
[
  { "type": "summarize", "node": "context", "status": "ok", "messages": 8, "estimatedTokens": 204, "content": "…" },
  { "type": "route", "node": "router", "route": "plan-and-execute", "source": "router",
    "reason": "Several incidents must be opened and resolved.",
    "content": "Route plan-and-execute (router): Several incidents must be opened and resolved." },
  { "type": "plan", "node": "plan-and-execute", "content": "[…]" },
  { "type": "answer", "node": "plan-and-execute", "content": "…" }
]
```

`source`:

| value | when |
|-------|------|
| `router` | router model chose the route |
| `override` | request carried `strategy`/`reflect`; router model not called |
| `fallback` | router failed or returned invalid output; route forced to `react` |

### Strategy failure fallback

If `plan-and-execute` or `reflection` throws, the turn re-runs with `react` and the trace
gets a second `route` event attributed to the failing node:

```json
{ "type": "route", "node": "plan-and-execute", "route": "react", "source": "fallback",
  "reason": "Strategy plan-and-execute failed: Failed to parse. Text: \"\". …", "content": "…" }
```

followed by the `react` events. A failing `react` still returns 500. The failed strategy's
model calls are not counted (it threw before reporting metrics).

## 200 response — metrics

`llmCalls` and `promptTokens` include the router call when the router model was invoked.
Other metrics (`historyMessages`, `contextBreakdown`, `contextBudget`) unchanged.

Error status codes (400, 404, 422, 500, 504) unchanged.
