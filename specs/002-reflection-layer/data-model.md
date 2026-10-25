# Data Model: OpsPilot Reflection Layer

## Reflection options

| Field | Type | Rules |
|---|---|---|
| `maxReflection` | integer | Non-negative safe integer; defaults to `2`; counts regenerations after the initial candidate. |
| `model` | chat model | Optional injected model; arena passes the same configured instance to its base strategy and critic; standalone callers may provide their base strategy's model. |
| `critic` | function | Optional injected structured reviewer for tests; production reviewer invokes the configured model. |
| `now` | function | Optional clock injection for deterministic latency tests. |

## Critic review

| Field | Type | Rules |
|---|---|---|
| `approved` | boolean | `true` accepts the candidate; `false` rejects it. |
| `feedback` | string | Required, trimmed, non-empty; included in the next input when rejected. |

The critic evaluates one candidate against the original operator question and
the strategy's `observation` events. Private reasoning events are excluded.
Question, answer, observations, and feedback are sanitized before inclusion in
critic or regeneration prompts.

## Reflection attempt

One attempt reviews the current candidate. It records the validated decision in
a `critique` event. If rejected and the regeneration budget remains, a fresh
wrapped-strategy run uses the original question, available observations, and
feedback. `maxReflection: 2` allows three reviews maximum (initial answer plus
two regenerated answers).

## Decorated strategy result

| Field | Type | Rules |
|---|---|---|
| `answer` | string | Latest candidate answer, including an unapproved candidate when retry budget is exhausted. |
| `trace` | TraceEvent[] | All base-run events in chronological order interleaved with one critique event per valid review. |
| `metrics.llmCalls` | integer | Sum of all base run calls and actual critic model starts. |
| `metrics.latencyMs` | number | Non-negative elapsed time for the entire decorated run. |

Each critique event identifies approval or rejection and contains sanitized
feedback. When the final candidate is still rejected at the retry ceiling, its
critique explicitly notes that no further regeneration was performed.

## Arena selector

- Existing values: `react`, `plan-and-execute`.
- Reflected values: `reflect:react`, `reflect:plan-and-execute`.
- `--max-reflection`: optional non-negative safe integer, default `2`; applies to
  reflected strategies and is ignored for unreflected selectors.
