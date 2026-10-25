# Contract: Context budget

## Configuration (environment)

| Variable | Default | Rule |
|----------|---------|------|
| `CONTEXT_BUDGET_SYSTEM` | 400 | never cut; over budget only reported |
| `CONTEXT_BUDGET_SUMMARY` | 200 | never cut; over budget only reported |
| `CONTEXT_BUDGET_HISTORY` | 1200 | drop oldest whole messages; `0` omits |
| `CONTEXT_BUDGET_MEMORIES` | 300 | drop lowest-score whole facts; `0` omits |

Invalid value (negative, fractional, non-numeric, empty) → the chat server does not start:
`<VARIABLE> must be a non-negative integer (got "<value>")`.

## Context passed to every strategy (`run(input)`) — chat, arena, bench

```text
System instructions:                   <- SYSTEM_PROMPT, never cut
<text>
Conversation summary (older messages): <- never cut
<summary>
Conversation history (oldest first):   <- newest messages that fit CONTEXT_BUDGET_HISTORY
User: ...
Semantic memory (relevant facts):      <- highest-score facts that fit CONTEXT_BUDGET_MEMORIES
- <fact>
Current message:                       <- never cut
User: <message>
```

Strategy-internal step prompts (planner, replanner, critic) are unchanged.

## `POST /chat` 200 response

`metrics.contextBudget`:

```json
{
  "system":   { "budget": 400,  "cut": "never",              "keptTokens": 96,   "droppedItems": 0, "droppedTokens": 0,    "overBudget": false },
  "summary":  { "budget": 200,  "cut": "never",              "keptTokens": 271,  "droppedItems": 0, "droppedTokens": 0,    "overBudget": true },
  "history":  { "budget": 1200, "cut": "oldest-first",       "keptTokens": 1180, "droppedItems": 6, "droppedTokens": 1466, "overBudget": false },
  "memories": { "budget": 300,  "cut": "lowest-score-first", "keptTokens": 0,    "droppedItems": 0, "droppedTokens": 0,    "overBudget": false }
}
```

`metrics.contextBreakdown` gains `system` and reflects the post-trim sections.

> **Updated by feature 013**: in `/chat`, the builder is called by the `context` node of the production graph (`src/graph/production-graph.ts`); the router receives the same built prompt. See [`specs/013-unified-production-graph/contracts/chat-routing.md`](../../013-unified-production-graph/contracts/chat-routing.md).
