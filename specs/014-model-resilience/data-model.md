# Data Model: Model Resilience

No storage changes. All entities are in-memory values validated with Zod.

## ModelSettings (`src/llm/model.ts`)

Parsed from the environment by `readModelSettings(env)`.

| Field | Type | Source | Rules |
|-------|------|--------|-------|
| `apiKey` | string | `OPENROUTER_API_KEY` | trimmed, required → else `ConfigurationError` |
| `primary` | string | `OPENROUTER_MODEL` | trimmed, required → else `ConfigurationError` |
| `reserve` | string \| null | `OPENROUTER_MODEL_FALLBACK` | trimmed; blank → `null`; equal to `primary` → `null` |
| `reserveIgnored` | `"same-as-primary"` \| null | derived | set when the reserve equals the primary |

Factory options (`createModel(env, options)`):

| Option | Type | Default | Purpose |
|--------|------|---------|---------|
| `attempts` | int ≥ 1 | `2` | attempts per model (`stopAfterAttempt`), primary and reserve |
| `buildChatModel` | `(model: string, apiKey: string) => BaseChatModel` | `ChatOpenAI` with OpenRouter base URL, `temperature: 0`, `maxRetries: 0` | test seam for scripted fakes |

## ModelErrorClass (`src/llm/model-errors.ts`)

`classifyModelError(error): "abort" | "permanent" | "transient"` — pure.

| Class | Errors | Retry primary | Use reserve |
|-------|--------|---------------|-------------|
| `abort` | `StrategyLimitError`, `ConfigurationError`, `AbortError` / aborted signal | no | no (rethrow as-is) |
| `permanent` | HTTP status 400, 401, 403, 404, 422 | no | yes |
| `transient` | 408, 409, 425, 429, ≥ 500, no status, output-parser errors | yes | yes, after last attempt |

## ModelFallbackReport (`src/llm/model-events.ts`)

Pushed by the factory into the current async scope when one call switches to the reserve.

| Field | Type | Rules |
|-------|------|-------|
| `primaryModel` | string | non-empty |
| `reserveModel` | string | non-empty, ≠ `primaryModel` |
| `reason` | string | `sanitizeTraceText`, 1–300 chars, e.g. `"Primary failed after 2 attempts: 503 Service Unavailable"` |

Scope API: `collectModelFallbacks(fn) → { value, fallbacks: ModelFallbackReport[] }`;
`reportModelFallback(report)` is a no-op outside a scope.

## Trace event `fallback` (`src/trace/trace.ts`)

New member of `traceEventSchema` (strict). Distinct from `route` events with `source: "fallback"`.

```json
{
  "type": "fallback",
  "node": "plan-and-execute",
  "primaryModel": "openrouter/free",
  "reserveModel": "openai/gpt-4o-mini",
  "reason": "Primary failed after 2 attempts: 503 Service Unavailable",
  "content": "Model fallback openrouter/free → openai/gpt-4o-mini: Primary failed after 2 attempts: 503 Service Unavailable"
}
```

- `node`: the graph node that made the call — `context` (summarizer), `router`, or a strategy node
  (`react`, `plan-and-execute`, `reflection`); required in chat responses like every event.
- `sanitizeTraceEvent` redacts `content` and `reason`.
- One event per call that switched; ordering: at the start of the emitting node's trace block.

## Chat metrics `modelUsed`

`metrics.modelUsed: string` (non-empty) added to `ProductionGraphOutput.metrics` and to the
`/chat` response schema.

`resolveModelUsed(trace, primaryModel)` (pure): `reserveModel` of the first `fallback` event if
any, else `primaryModel`.

## ModelUnavailableError (`src/domain/errors.ts`)

`class ModelUnavailableError extends OpsPilotError` — thrown by the factory when the primary
(after retries) and the reserve (if any) both fail with a non-`abort` error. Message is fixed and
safe (`"Language models are unavailable; try again later."`); the provider error is kept only
as `cause`.

## State transitions — one model call

```text
primary attempt ──ok──────────────────────────────▶ result (no event)
   │ fail
   ├─ abort ───────────────────────────────────────▶ rethrow original error
   ├─ transient & attempts left ──backoff──▶ primary attempt
   └─ permanent, or transient & no attempts left
          ├─ no reserve ───────────────────────────▶ ModelUnavailableError
          └─ reserve: report fallback + log ──▶ reserve attempts (same retry rules)
                 ├─ ok ────────────────────────────▶ result (fallback event)
                 └─ fail (non-abort) ─────────────▶ ModelUnavailableError
```
