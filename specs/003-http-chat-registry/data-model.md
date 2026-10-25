# Data Model: OpsPilot HTTP Chat Registry

## Entities

### ChatRequest

| Field | Type | Required | Notes |
|---|---|---:|---|
| message | string | Yes | Operator input text; must be present and non-empty under the request schema. |
| strategy | enum | No | Supported names include `react` and `plan-and-execute`; default is `react`. |
| reflect | boolean | No | Optional reflection toggle; if enabled, the selected strategy is wrapped with the reflection decorator. |

### StrategyRegistry

| Field | Type | Notes |
|---|---|---|
| entries | Map<string, ReasoningStrategy> | Central map of strategy names to strategy instances. |
| reflectedEntries | Map<string, ReasoningStrategy> | Optional resolved strategy names that apply a reflection wrapper when explicitly requested. |

### StrategyResult

| Field | Type | Notes |
|---|---|---|
| answer | string | Final user-facing answer value from the strategy. |
| trace | TraceEvent[] | Ordered evidence and reasoning events produced by the strategy. |
| metrics | object | Contains LLM-call counts and elapsed runtime as reported by the strategy contract. |

### RequestError

| Field | Type | Notes |
|---|---|---|
| statusCode | number | `400`, `422`, or `504` for the supported error boundary outcomes. |
| message | string | Human-readable error summary. |
| issues | object[] | Zod validation details when body validation fails. |

## Validation rules

- `message` must be present and non-empty.
- `strategy` must be one of the known registry names.
- `reflect` must be a boolean when provided.
- The registry must reject unsupported names instead of selecting another strategy.
- The HTTP service must enforce a 180s timeout for each request.

## Relationships

- A `ChatRequest` resolves to one `StrategyRegistry` entry.
- A selected strategy produces exactly one `StrategyResult`.
- A reflected request reuses the same `StrategyResult` shape after wrapping the selected strategy in the reflection decorator.
