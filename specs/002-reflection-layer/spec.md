# Feature Specification: OpsPilot Reflection Layer

**Feature Branch**: `002-reflection-layer`

**Created**: 2026-10-06

**Status**: Draft

**Input**: User description: "Add a Reflection layer that decorates any ReasoningStrategy, runs a structured critic over the answer and trace observations, regenerates rejected answers with feedback, records critique events and additional model metrics, and can be selected in the arena for ReAct or Plan-and-Execute."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Review and improve an operational answer (Priority: P1)

As an incident-response operator, I want OpsPilot to review a strategy's answer against the observed tool results and improve it when the evidence does not support it, so that I can rely on answers that better match the operational facts.

**Why this priority**: Unsupported or incomplete answers are the primary problem the reflection layer addresses.

**Independent Test**: Supply a deterministic strategy, critic, and regeneration fake. Verify that an approved answer is returned immediately, while a rejected answer is regenerated with the supplied feedback and reviewed again.

**Acceptance Scenarios**:

1. **Given** a base strategy result whose answer matches the observations, **When** reflection reviews it, **Then** the decorated strategy returns the answer without regenerating it and appends an approval critique event.
2. **Given** a base answer the critic rejects, **When** the critic supplies feedback, **Then** that feedback is included in the next strategy context, the answer is regenerated, and the new result is reviewed.
3. **Given** the critic keeps rejecting regenerated answers, **When** the configured retry limit is reached, **Then** the strategy returns the latest regenerated result, marks the last review as not approved in its trace, and performs no further regeneration.

---

### User Story 2 - Use reflection with either reasoning strategy (Priority: P1)

As an OpsPilot operator, I want to select a reflected ReAct or reflected Plan-and-Execute run in the arena, so that I can compare reviewed answers with the unreflected strategies.

**Why this priority**: The reflection layer is useful only if it can be applied consistently to both existing strategies and exercised through the arena.

**Independent Test**: Run the arena with each reflected strategy name and fake dependencies; verify the selected base strategy receives the question and the result includes both its original events and reflection events.

**Acceptance Scenarios**:

1. **Given** the ReAct reflection selector, **When** the arena runs it, **Then** it decorates the ReAct strategy and returns that run's reviewed result.
2. **Given** the Plan-and-Execute reflection selector, **When** the arena runs it, **Then** it decorates the Plan-and-Execute strategy and returns that run's reviewed result.
3. **Given** an unsupported reflection selector, **When** the arena parses the request, **Then** it reports an actionable input error rather than silently selecting another strategy.

---

### User Story 3 - Inspect reflection outcomes and costs (Priority: P2)

As an operator, I want the trace and metrics to show the critic decisions and total model work, so that I can understand whether an answer was approved and the cost of improving it.

**Why this priority**: Reflection adds model calls and can end without approval; both outcomes must be visible to support evaluation and safe use.

**Independent Test**: Use fake base and critic calls with a controlled clock; verify ordered critique events and exact aggregated call counts and elapsed time for approval and retry-limit paths.

**Acceptance Scenarios**:

1. **Given** an answer that is approved, **When** the decorated strategy completes, **Then** its trace contains the critic's approval event and its LLM metric includes the base and critic calls.
2. **Given** one or more rejected answers, **When** reflection completes, **Then** its trace records each rejection and feedback in order and its LLM metric includes all base, critic, and regeneration calls.
3. **Given** reflection reaches its retry limit without approval, **When** the arena prints the result, **Then** the trace makes the unapproved outcome explicit and metrics include every attempted model call.

### Edge Cases

- The strategy returns an empty answer or no observation events.
- The critic returns malformed structured output or blank feedback for a rejected answer.
- The critic approves an answer despite contradictory observations.
- A regeneration strategy call fails after feedback is supplied.
- The base strategy or critic fails before a valid review is available.
- The configured retry limit is zero, negative, fractional, or beyond the safe integer range.
- The final generated answer has not been approved when the retry limit is exhausted.
- Existing strategy calls already consume their own configured iteration budget before reflection calls are added.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST allow the reflection layer to decorate any strategy implementing the existing common reasoning-strategy contract without changing that strategy's public input/result shape.
- **FR-002**: A reflected run MUST execute the base strategy first and provide its answer and trace observations to an independent review.
- **FR-003**: A review MUST return a structured approval decision and feedback. Invalid review output MUST be reported as an explicit failure.
- **FR-004**: The review MUST evaluate whether the answer is supported by the observations in the trace; it MUST NOT rely on hidden reasoning that is absent from the trace.
- **FR-005**: When a review rejects an answer, the system MUST include the review feedback in the next run context and regenerate the answer using the same configured model as the wrapped strategy.
- **FR-006**: The system MUST stop when a review approves the answer or the configured reflection retry limit is reached. The default retry limit MUST be two regenerations after the initial answer.
- **FR-007**: If the retry limit is reached without approval, the system MUST return the latest answer and make its unapproved state explicit in the trace.
- **FR-008**: Each review MUST append a typed `critique` event to the result trace in execution order. Rejection feedback and the approval state MUST be represented without exposing secrets or private chain-of-thought.
- **FR-009**: The reflected result MUST preserve the wrapped strategy's trace and MUST report total LLM calls across the base strategy, reviews, and regenerations, along with the elapsed duration of the complete reflected run.
- **FR-010**: The arena MUST support `reflect:react` and `reflect:plan-and-execute` selectors in addition to existing unreflected strategies.
- **FR-011**: The arena MUST accept a configurable reflection retry limit and reject malformed values with an actionable input error.
- **FR-012**: Reflection tests MUST be deterministic and able to verify review decisions, feedback propagation, stop conditions, trace ordering, and call totals without external model requests.

### Key Entities

- **Reflected strategy**: A base reasoning strategy paired with review and regeneration behavior and a configured retry limit.
- **Review decision**: A structured approval boolean and feedback evaluating the answer against observed trace results.
- **Reflection attempt**: One review of a candidate answer and, when rejected and under the retry limit, its feedback-driven regeneration.
- **Critique event**: An ordered trace event containing an approval/rejection outcome and concise review feedback.
- **Reflected result**: The latest answer and combined trace with model-call totals and latency for the full decorated run.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a matching answer, one review approves it and no regeneration occurs.
- **SC-002**: For a rejected answer, the next strategy input contains the exact non-secret review feedback and yields a separately reviewed candidate.
- **SC-003**: No run performs more than two regenerations by default, and a caller-provided valid limit is never exceeded.
- **SC-004**: Every completed reflected run has an ordered trace containing all base events and one critique event per completed review.
- **SC-005**: The reported call total equals the sum of all base-strategy, review, and regeneration model invocations in deterministic scenarios.
- **SC-006**: Both supported reflected strategy selectors produce a result through the arena, while invalid selectors fail visibly.

## Assumptions

- `maxReflection` counts answer regenerations after the initial answer; each regenerated answer receives a review before the run returns. With a limit of two, at most three reviews and two regenerations occur.
- Rejected-answer feedback is added to the next strategy input while retaining the original operator question and the base strategy's relevant trace context.
- The critic uses the same configured model factory/configuration as the wrapped strategy. Tests may inject deterministic fakes for both model roles.
- Reflection is opt-in; the existing `react` and `plan-and-execute` selectors retain their current behavior.
- The requested `reflec:plan-and-execute` spelling is treated as a typo; the consistent selector is `reflect:plan-and-execute`.
- A review can only assess evidence present in the operator-facing trace, including tool observations; it does not request or expose private model reasoning.
- Reflection adds its model work to the wrapped run's metric rather than resetting or replacing the base strategy's reported calls.
