# Research: OpsPilot Reflection Layer

## Decision 1: Decorate the existing strategy contract

- **Decision**: Implement `withReflection(strategy, opts)` as a wrapper that
  returns a `ReasoningStrategy` and leaves the wrapped strategy API unchanged.
- **Rationale**: The existing interface makes strategies substitutable and the
  decorator can be reused for ReAct, Plan-and-Execute, and future strategies.
  Reuse one wrapped instance for regeneration so its configured store and
  dependencies remain the same.
- **Alternatives considered**: Add reflection nodes separately to both agent
  implementations; rejected because it duplicates review policy and makes the
  feature unavailable to other strategies.

## Decision 2: Regenerate by rerunning with preserved evidence and feedback

- **Decision**: On rejection, construct the next strategy input from the original
  operator question, the answer's observation events, and the critic's feedback.
  Rerun the same decorated base strategy object. Each regenerated answer gets a
  new review.
- **Rationale**: The existing strategy interface accepts only a string and
  returns answer/trace/metrics. A context-augmented input uses that stable
  contract without adding strategy-specific regeneration hooks. The shared
  instance preserves in-memory tool changes made during earlier runs.
- **Alternatives considered**: Mutate the prior result into a new answer without
  another strategy call; rejected because that would not be regeneration.
  Change the interface to accept structured feedback; rejected to avoid
  breaking existing strategies.

## Decision 3: Validate critic response as structured data and count actual model invocations

- **Decision**: Define a strict Zod response `{ approved: boolean, feedback: string }`
  with non-empty feedback. Use the same `createModel()` OpenRouter configuration
  as the strategies and `withStructuredOutput`. Pass a LangChain callback in the
  runnable invocation config and count `handleChatModelStart`, including failed
  attempts.
- **Rationale**: The project already uses Zod-validated structured outputs for
  Plan-and-Execute. Official LangChain JS model docs show `invoke(input, {
  callbacks })` as the runtime configuration path, and the existing ReAct
  strategy counts calls from `handleChatModelStart`. Measuring the callback
  records actual model runs rather than assuming one call per chain invocation.
- **Alternatives considered**: Count each critic `invoke` as exactly one model
  call; rejected because a structured-output runnable may perform more than one
  underlying model request. Add a new model dependency; rejected because the
  existing OpenRouter factory already centralizes configuration.
- **Reference**: [LangChain JS model invocation configuration](https://docs.langchain.com/oss/javascript/langchain/models)

## Decision 4: Make reflection opt-in via explicit arena selectors

- **Decision**: Extend arena names with `reflect:react` and
  `reflect:plan-and-execute`; keep `react` and `plan-and-execute` unchanged.
  Add `--max-reflection` as a non-negative integer with default `2`, counting
  regenerations after the initial answer.
- The arena creates one shared `ChatOpenAI` instance for each reflected run and
  injects it into both the base strategy and the critic. Callers wrapping a
  custom strategy outside the arena can supply its configured model through the
  decorator's `model` option; model configuration is not inferable from the
  generic strategy interface.
- **Rationale**: Explicit selectors support direct comparison and avoid
  unexpectedly adding model calls to existing users. The retry option is
  independently controllable from each base strategy's model-call limit.
- **Alternatives considered**: Reflect every arena strategy by default; rejected
  because it changes cost and latency for existing commands. Interpret
  `maxReflection` as number of reviews; rejected in favor of the spec's explicit
  definition as regenerations.

## Decision 5: Aggregate metrics and preserve chronological trace

- **Decision**: Sum `llmCalls` from every wrapped strategy run and every critic
  model start. Measure total wrapper latency from before the first base run
  until completion. Append one sanitized `critique` trace event after each valid
  review and preserve every base trace in run order.
- **Rationale**: The arena can then report the cost and audit trail for the
  complete reflection lifecycle. Rejections at the retry limit remain explicit.
- **Alternatives considered**: Return only the most recent run's metrics or trace;
  rejected because this hides the work and evidence that led to the final result.

## Resolved requirements boundary

Before a model call, sanitize the original question, candidate answer, each
observation, and feedback with the shared trace redaction helper. The decorator
reviews only the sanitized original question, candidate answer, and
operator-visible observation events. It does not forward `thought` events or
private reasoning. Invalid structured review output and strategy/model errors
remain explicit failures. If a regeneration fails, the wrapper propagates the
failure instead of presenting a previous rejected answer as success.
