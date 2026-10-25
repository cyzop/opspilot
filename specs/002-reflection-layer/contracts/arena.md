# Contract: Reflection Arena Options

## Strategy selection

`--strategies` accepts comma-separated values from:

- `react`
- `plan-and-execute`
- `reflect:react`
- `reflect:plan-and-execute`

Existing unreflected selectors retain their behavior. Duplicate and unknown
values remain actionable input errors.

## Reflection limit

`--max-reflection <integer>` is optional and defaults to `2`. It must be a
non-negative safe integer. The value is the maximum number of regenerations for
each reflected strategy and has no effect on unreflected strategies.

The normal arena result output includes the decorated answer, chronological
base/critique trace, total `llmCalls`, and total `latencyMs`.
