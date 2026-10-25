# Contract: model resilience in `POST /chat` and the model factory

## Configuration (`.env`)

| Variable | Required | Meaning |
|----------|----------|---------|
| `OPENROUTER_API_KEY` | yes | unchanged |
| `OPENROUTER_MODEL` | yes | primary model |
| `OPENROUTER_MODEL_FALLBACK` | no | reserve model, same provider and key; blank or equal to the primary = no reserve |

Startup line printed once by the chat server (one of):

```text
Model fallback enabled: <primary> → <reserve>
Model fallback not configured: retries only on <primary>
Model fallback ignored: OPENROUTER_MODEL_FALLBACK equals OPENROUTER_MODEL
```

## Factory (`src/llm/model.ts`)

```ts
createModel(env?: OpenRouterEnvironment, options?: { attempts?: number; buildChatModel?: ... }): ResilientChatModel
```

- Same call shape as today; every caller (chat, arena, bench, MCP) gets retry + reserve.
- `invoke`, `bindTools(...)` and `withStructuredOutput(...)` all apply: primary with
  `attempts` attempts (default 2) → reserve with the same attempts → `ModelUnavailableError`.
- `StrategyLimitError`, `ConfigurationError` and aborts pass through unchanged.

## 200 response — healthy primary

```json
{
  "answer": "…",
  "trace": [
    { "type": "route", "node": "router", "route": "react", "source": "router", "reason": "…", "content": "…" },
    { "type": "answer", "node": "react", "content": "…" }
  ],
  "conversationId": "…",
  "metrics": { "llmCalls": 2, "latencyMs": 1830, "modelUsed": "openrouter/free", "…": "…" }
}
```

No `fallback` event.

## 200 response — reserve used

```json
{
  "trace": [
    { "type": "fallback", "node": "router", "primaryModel": "openrouter/free", "reserveModel": "openai/gpt-4o-mini",
      "reason": "Primary failed after 2 attempts: 503 Service Unavailable",
      "content": "Model fallback openrouter/free → openai/gpt-4o-mini: Primary failed after 2 attempts: 503 Service Unavailable" },
    { "type": "route", "node": "router", "route": "react", "source": "router", "reason": "…", "content": "…" },
    { "type": "fallback", "node": "react", "primaryModel": "openrouter/free", "reserveModel": "openai/gpt-4o-mini", "reason": "…", "content": "…" },
    { "type": "answer", "node": "react", "content": "…" }
  ],
  "metrics": { "modelUsed": "openai/gpt-4o-mini", "…": "…" }
}
```

- One `fallback` event per call that switched, tagged with the node that made it.
- `metrics.modelUsed` is the reserve if any call in the turn used it.
- `reason` and `content` are redacted (secret patterns) and `reason` is ≤ 300 chars.

## 503 response — no model available

Returned when the answering strategy (ReAct, or the ReAct fallback of another strategy) cannot
get a response from the primary (after retries) or the reserve.

```json
{ "error": "Language models are unavailable; try again later." }
```

- The user/assistant exchange is **not** persisted; a new conversation id is not returned.
- Router failure alone → still `route` with `source: "fallback"` (feature 013); summarizer failure
  alone → previous summary kept (`summarize` `status: "failed"`); neither returns 503.

## Unchanged status codes

| Status | When |
|--------|------|
| 400 | invalid body |
| 404 | unknown `conversationId` |
| 422 | unknown `strategy` |
| 504 | turn timeout |
| 500 | any other error |
