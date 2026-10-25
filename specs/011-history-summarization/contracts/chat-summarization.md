# Contract: `POST /chat` with history summarization

Request body and error status codes are unchanged.

## Context sent to the strategy (prompt text)

Sections, in order, each present only when non-empty:

```text
Semantic memory (relevant facts):
- <fact>
Conversation summary (older messages):
<summary text>
Conversation history (oldest first):
User: ...            <- pending (unsummarized, outside window) then recent 8
Assistant: ...
Current message:
User: <message>
```

With no memory, no summary and no history, the prompt is the bare message (unchanged).

> **Updated by feature 012**: the context is now assembled by the context builder in the
> order system instruction → summary → history → memories → current message, with
> per-section budgets (`CONTEXT_BUDGET_*`; history trimmed oldest-first, summary never
> cut). The prompt is never the bare message anymore. See
> [`specs/012-context-budget-builder/contracts/context-budget.md`](../../012-context-budget-builder/contracts/context-budget.md).

## 200 response changes

### `trace`

When summarization was attempted in this turn, the **first** trace element is:

```json
{
  "type": "summarize",
  "status": "ok",
  "messages": 8,
  "estimatedTokens": 143,
  "content": "Summarized 8 older messages into ~143 tokens."
}
```

Failure variant: `"status": "failed"`, `"estimatedTokens": null`, `content` starting with
`"Summarization failed; previous summary kept"`. No `summarize` element otherwise.

### `metrics`

| Field | Change |
|-------|--------|
| historyMessages | now `pending + recent` verbatim messages (8–15 once a conversation is long) |
| contextBreakdown.summary | **new** int ≥ 0 |
| contextBreakdown.total | now includes `summary` |
| promptTokens, llmCalls | exclude the summarizer call |

## Summarization trigger (observable)

Summarization is attempted in a turn iff, before the turn, the number of stored messages
newer than the summary coverage minus 8 is ≥ 8. For a new conversation (2 messages per
turn) that is turns 9, 13, 17, 21, … (16, 24, 32, 40 prior messages).
