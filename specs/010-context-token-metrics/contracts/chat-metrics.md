# Contract: `POST /chat` response metrics

Request contract is unchanged. Status codes and error bodies are unchanged.

## 200 response — `metrics` object (strict)

```json
{
  "llmCalls": 3,
  "latencyMs": 2140,
  "historyMessages": 4,
  "promptTokens": 1873,
  "contextBreakdown": {
    "method": "chars/4",
    "history": 142,
    "memory": 18,
    "message": 11,
    "total": 171
  }
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| llmCalls | int ≥ 0 | yes | unchanged |
| latencyMs | number ≥ 0 | yes | unchanged |
| historyMessages | int ≥ 0 | yes | unchanged |
| promptTokens | int ≥ 0 \| `null` | yes | Real, provider-reported; sum over all model calls of the turn. `null` = unavailable |
| contextBreakdown.method | `"chars/4"` | yes | Marks the breakdown as an estimate |
| contextBreakdown.history | int ≥ 0 | yes | 0 without `conversationId` or with empty history |
| contextBreakdown.memory | int ≥ 0 | yes | 0 without `userId` or with no recalled facts |
| contextBreakdown.message | int ≥ 0 | yes | ≥ 1 (message is non-empty) |
| contextBreakdown.total | int ≥ 0 | yes | `history + memory + message` |

Validated with Zod (`chatResponseSchema`) before sending. A turn that fails (4xx/5xx)
returns no metrics, as today.

> **Updated by feature 011**: `contextBreakdown` also has `summary` (int ≥ 0), and
> `total = history + memory + summary + message`. See
> [`specs/011-history-summarization/contracts/chat-summarization.md`](../../011-history-summarization/contracts/chat-summarization.md).

## Strategy layer (`strategyResultSchema.metrics`)

Adds optional `promptTokens: int ≥ 0 | null`. Absent is treated as `null` at the HTTP edge.
