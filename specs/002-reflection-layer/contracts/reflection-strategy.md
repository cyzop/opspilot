# Contract: Reflection Strategy Decorator

## Public behavior

`withReflection(strategy, opts)` returns a strategy compatible with the
existing `ReasoningStrategy` interface. It runs the wrapped strategy with the
operator's original question, reviews the result, and returns after approval
or when its regeneration budget is exhausted.

## Review input and output

The critic receives:

- the original operator question;
- the candidate answer;
- only operator-visible `observation` events from the candidate trace.
- sanitized values of those fields; credential-like text and structured secret
  fields are redacted before sending data to the critic.

It returns a strict structured object:

```text
{ approved: boolean, feedback: non-empty string }
```

Malformed data is an explicit error. Rejection feedback must be present in the
next wrapped-strategy input alongside the original question and prior
sanitized observations. Feedback and the assembled regeneration prompt must be
sanitized before use.

The model dependency is explicit in decorator options. Arena-provided wrappers
receive the same model instance as the base strategy. Callers decorating custom
strategies supply that strategy's configured model explicitly when the shared
OpenRouter factory is not appropriate.

## Retry semantics

- `maxReflection` is a non-negative safe integer; default is `2`.
- It counts regenerations, not reviews.
- Each candidate, including each regenerated candidate, is reviewed once.
- Zero means review the initial answer once and never regenerate.
- The final candidate may remain unapproved if the limit is exhausted; the last
  critique event must say so.
- A wrapped-strategy, critic, or model failure propagates as a failure; do not
  fall back to a previously rejected candidate.

## Trace and metrics

- Preserve base trace events in execution order.
- Append one sanitized `critique` event per completed review, including
  decision and feedback; do not include hidden reasoning or secrets.
- `llmCalls` equals all base strategy calls plus every actual critic model start.
- `latencyMs` measures the entire decorator run.

## Arena selectors

The arena accepts `reflect:react` and `reflect:plan-and-execute` in addition to
the existing strategy names. `--max-reflection` configures the decorator and
defaults to `2`.
