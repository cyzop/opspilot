# Data Model: Context Budget Builder

No persisted data. Revised at implementation to follow the user's reference sketch
(`section(name, content, { budget, cut })` → `fitToBudget` → `assemble`).

## ContextBudget

| Field | Env | Default | Cut rule |
|-------|-----|---------|----------|
| system | `CONTEXT_BUDGET_SYSTEM` | 400 | `never` (informative) |
| summary | `CONTEXT_BUDGET_SUMMARY` | 200 | `never` (informative) |
| history | `CONTEXT_BUDGET_HISTORY` | 1200 | `oldest-first` (enforced) |
| memories | `CONTEXT_BUDGET_MEMORIES` | 300 | `lowest-score-first` (enforced) |

Each value: integer ≥ 0, string must match `^\d+$`. `contextBudgetSchema` (strict).
`loadContextBudget(env)` → ContextBudget or throws `ConfigurationError` naming the variable.
`UNLIMITED_CONTEXT_BUDGET` = `Number.MAX_SAFE_INTEGER` for every field.

## Section (internal)

`{ name: "system" | "summary" | "history" | "memories"; budget: number; cut: "never" | "oldest-first" | "lowest-score-first"; items: SectionItem[] }`

- system: one item (SYSTEM_PROMPT text)
- summary: one item (summary text) or none
- history: one item per message (`User: …` / `Assistant: …`), oldest first
- memories: one item per fact (`- fact`) with `score`, recall order

## BuildContextInput

| Field | Type |
|-------|------|
| message | string (untouchable) |
| history | ConversationMessage[] (feature 011 pending + recent), default [] |
| summary | string \| null, default null |
| memories | `{ fact: string; score: number }[]`, default [] |
| budget | ContextBudget |
| systemPrompt | string, default `SYSTEM_PROMPT` |

## BuiltContext

| Field | Type | Notes |
|-------|------|-------|
| prompt | string | rendered sections joined by `\n` in order system, summary, history, memories, then `Current message:\nUser: <message>` |
| sections | `{ system, summary, history, memory, message }` rendered strings (post-trim) | feeds `estimateContextBreakdown` |
| report | ContextBudgetReport | |

Rendered headers: `System instructions:`, `Conversation summary (older messages):`,
`Conversation history (oldest first):`, `Semantic memory (relevant facts):`.

## SectionReport / ContextBudgetReport

`ContextBudgetReport = { system, summary, history, memories }`, each:

| Field | Type | Rule |
|-------|------|------|
| budget | int ≥ 0 | configured ceiling |
| cut | `"never" \| "oldest-first" \| "lowest-score-first"` | section rule |
| keptTokens | int ≥ 0 | estimate of the rendered kept section; ≤ budget for enforced sections |
| droppedItems | int ≥ 0 | messages/facts removed (always 0 for `never`) |
| droppedTokens | int ≥ 0 | `max(0, untrimmed − kept)` |
| overBudget | boolean | `never` section whose kept size exceeds its budget |

## ContextBreakdown (extended from 010/011)

Adds `system: int ≥ 0`; `total = system + history + memory + summary + message`.
