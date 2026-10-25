# Contract: Reasoning Strategy

## Input and result

- Input: one non-empty operator question.
- Result: `answer: string`, ordered `trace: TraceEvent[]`, and
  `metrics: { llmCalls: number; latencyMs: number }`.
- Validate the returned result against a Zod result schema before exposing it to
  the arena.
- Strategy identity: `name` is `react` or `plan-and-execute`.
- Public execution contract: `run(input)` returns a promise of the result. A
  strategy instance is configured with its dependencies and maximum iterations
  when constructed.

## Trace events

`type` is one of:

- `thought`: model reasoning summary suitable for the operator-facing trace.
- `action`: tool invocation; MUST include `tool` and validated `args`.
- `observation`: tool result or explicit tool error.
- `plan`: ordered plan steps or the revised remaining steps.
- `critique`: evaluation/replanning rationale.
- `answer`: final answer.

Events preserve execution order. Raw secrets, API credentials, and `.env`
contents MUST NOT be included in trace content or arguments.
Thought events are concise operational summaries, not private chain-of-thought
transcripts.

## Limits and metrics

- `maxIterations` is a positive integer configured when creating the strategy
  and caps all model invocations in that run.
- ReAct MUST NOT invoke the model more than `maxIterations` times.
- Plan-and-Execute MUST count planner and replanner model invocations against
  the same cap and MUST execute no more than eight actions.
- Plan-and-Execute records each completed step and its tool result as a pair in
  `done`. After each action, the replanner explicitly chooses `adjust`,
  `continue`, or `finish` for the remaining work.
- LangGraph's graph-superstep recursion limit is an additional safety bound, not
  the definition or metric for LLM calls.
- `llmCalls` counts every model invocation attempted by the run, including
  planner, executor, replanner, and failed invocations.
- `latencyMs` is the elapsed wall time from strategy start through completion.
- If the bound is reached before a final model answer, return an explicit
  bounded-run answer with the accumulated trace and metrics.

## Failure behavior

Missing model configuration, invalid structured model output, invalid tool
arguments, and tool/domain failures MUST remain explicit. A tool failure is
recorded as an error observation where possible and MUST NOT be represented as a
successful observation.
