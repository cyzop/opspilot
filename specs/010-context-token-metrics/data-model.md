# Data Model: Context Token Metrics

No persisted entities. All values are computed per chat turn and returned in the response.

## TokenEstimate (value)

| Field | Type | Rule |
|-------|------|------|
| value | integer ≥ 0 | `ceil(text.length / 4)`; `""` → 0 |

Produced by `estimateTokens(text: string): number` (pure).

## ModelUsage (per model call)

| Field | Type | Rule |
|-------|------|------|
| inputTokens | integer ≥ 0 \| null | From `LLMResult.generations[*][*].message.usage_metadata.input_tokens`, else `llmOutput.tokenUsage.promptTokens`; `null` when missing or invalid (Zod-validated) |

Produced by `inputTokensFromLlmResult(output: unknown): number | null` (pure).

## UsageRecorder (per strategy run)

| Member | Description |
|--------|-------------|
| `handler` | LangChain callback object implementing `handleLLMEnd`, appends a `ModelUsage` |
| `promptTokens()` | `sumPromptTokens(recorded)` |

`sumPromptTokens(values: readonly (number | null)[]): number | null` (pure):
- `[]` → `null` (nothing observed)
- any `null` → `null`
- otherwise → sum

State: created empty at the start of `run()`, appended to on each model call end, read once
when building `metrics`. Never shared between runs.

## StrategyResult.metrics (extended)

| Field | Type | Change |
|-------|------|--------|
| llmCalls | integer ≥ 0 | unchanged |
| latencyMs | number ≥ 0 | unchanged |
| promptTokens | integer ≥ 0 \| null, optional | **new**; absent ≡ unavailable |

Reflection: `promptTokens = sumPromptTokens([...each regeneration's promptTokens ?? null, ...critic usages])`.

## ChatContext (per chat turn)

Returned by `composeChatContext(message, history, memoryFacts)`:

| Field | Type | Rule |
|-------|------|------|
| prompt | string | identical to today's `composeChatPrompt` output |
| sections.history | string | rendered `Conversation history...` block after 12-message window, or `""` |
| sections.memory | string | rendered `Semantic memory...` block, or `""` |
| sections.message | string | rendered `Current message:` block, or the bare message when no other section exists |

## ContextBreakdown (per chat turn)

| Field | Type | Rule |
|-------|------|------|
| method | literal `"chars/4"` | labels the values as estimates |
| history | integer ≥ 0 | `estimateTokens(sections.history)` |
| memory | integer ≥ 0 | `estimateTokens(sections.memory)` |
| message | integer ≥ 0 | `estimateTokens(sections.message)` |
| total | integer ≥ 0 | `history + memory + message` |

Produced by `estimateContextBreakdown(sections)` (pure). Excludes system instructions and
tool definitions, so `total` is expected to be ≤ `promptTokens`.
