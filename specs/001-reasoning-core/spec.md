# Feature Specification: OpsPilot Reasoning Core

**Feature Branch**: `001-reasoning-core`

**Created**: 2026-10-03

**Status**: Draft

**Input**: User description: "Create the OpsPilot reasoning core with a shared strategy contract, OpenRouter model configuration, alert and incident tools, ReAct and Plan-and-Execute strategies, an arena CLI, and deterministic store/trace tests."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Compare reasoning strategies (Priority: P1)

As an OpsPilot developer or incident-response operator, I can submit one operational question to one or more reasoning strategies and inspect each answer, event trace, and metric so that I can compare how they reached their conclusions.

**Why this priority**: The arena is the primary way to exercise and compare the reasoning core.

**Independent Test**: Run the arena with a fixed input and one strategy; verify it prints that strategy's answer, ordered trace events, LLM-call count, and latency. Repeat with multiple strategies and verify they receive the same input.

**Acceptance Scenarios**:

1. **Given** a valid input and one or more supported strategy names, **When** the operator runs the arena, **Then** every selected strategy receives the same input and its answer, trace, and metrics are printed.
2. **Given** a maximum-iteration value, **When** a strategy reaches that limit, **Then** it stops further reasoning and reports the trace and metrics accumulated so far.
3. **Given** an unknown strategy name or invalid iteration value, **When** the operator invokes the arena, **Then** it reports an actionable input error and does not silently substitute a strategy or limit.

---

### User Story 2 - Inspect and manage alert incidents (Priority: P1)

As an incident-response operator, I can ask the reasoning agent about firing or resolved alerts, open an incident for a service, and resolve an existing incident so that the agent can support routine on-call triage.

**Why this priority**: Alert and incident operations are the core domain actions the strategies must reason about.

**Independent Test**: Use a deterministic seeded store to list alerts, open an incident, and resolve it; verify returned records and subsequent store state.

**Acceptance Scenarios**:

1. **Given** alerts in both firing and resolved states, **When** the operator requests firing, resolved, or all alerts, **Then** only alerts matching the selected status are returned.
2. **Given** a known service and valid incident details, **When** an incident is opened, **Then** a new incident is returned with the requested title, service, and severity.
3. **Given** an existing incident, **When** it is resolved, **Then** it is marked resolved; **When** an unknown identifier is supplied, **Then** the operation returns a domain error that the caller can translate.
4. **Given** the seed operation is run, **When** the seeded data is inspected, **Then** it contains five services and six varied alerts, exactly three firing and three resolved.

---

### User Story 3 - Use bounded reasoning strategies (Priority: P2)

As an operator, I can select ReAct or Plan-and-Execute under a finite iteration/step limit so that tool use is inspectable and cannot continue indefinitely.

**Why this priority**: Bounded, comparable reasoning is required for safe experimentation with an autonomous on-call assistant.

**Independent Test**: Supply controlled model responses and tools; verify each strategy emits a complete ordered trace, reports its LLM-call count and elapsed time, and stops at its configured bound.

**Acceptance Scenarios**:

1. **Given** a question answerable with alert tools, **When** ReAct runs, **Then** its trace records reasoning, tool action and arguments, tool observation, and final answer in execution order.
2. **Given** a question requiring multiple operational steps, **When** Plan-and-Execute runs, **Then** it creates a plan, executes one step at a time, revises remaining work after each step, and finishes when no steps remain.
3. **Given** a Plan-and-Execute run, **When** its plan would exceed eight steps, **Then** it executes no more than eight steps.
4. **Given** any strategy run, **When** LLM requests complete, **Then** its metric reports the number of LLM calls and elapsed milliseconds for that run.

### Edge Cases

- Required OpenRouter model configuration is absent or blank.
- The model returns an invalid structured plan or no remaining steps.
- A requested tool argument is malformed, references an unknown service, or references an unknown incident.
- A tool fails during a strategy run; the failure is represented in the trace and does not become a fabricated successful observation.
- A strategy reaches its iteration or step limit before producing a final answer.
- No alerts match the requested status.
- The operator selects no strategies, a duplicate strategy, or an unsupported strategy.
- Seed data already exists when the seed command is run.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST expose a common strategy contract that accepts an input and returns an answer, an ordered trace, and metrics.
- **FR-002**: Every trace event MUST have a typed category: thought, action, observation, plan, critique, or answer. An action event MUST identify the tool and its arguments.
- **FR-003**: Every strategy result MUST include the number of LLM calls and elapsed time in milliseconds.
- **FR-004**: The system MUST use the configured OpenRouter model and endpoint with temperature set to zero. If the API key or model name is missing, it MUST report a configuration error before attempting a model call.
- **FR-005**: The system MUST provide alert-listing, incident-opening, and incident-resolution operations. Alert listing MUST support firing, resolved, and all statuses; opening MUST capture title, service, and severity; resolving MUST identify the incident.
- **FR-006**: The system MUST validate external and tool-operation inputs with schemas and return actionable validation or domain errors.
- **FR-007**: The seed operation MUST create or restore a predictable baseline of five services and six varied alerts, with exactly three firing and three resolved, and MUST be runnable as a script.
- **FR-008**: ReAct MUST use the alert and incident operations, produce the complete ordered trace, and stop when its configured iteration limit is reached.
- **FR-009**: Plan-and-Execute MUST produce a structured list of steps, execute one step at a time, record each completed step with its result, and let the replanner explicitly adjust, continue, or finish after each step.
- **FR-010**: Plan-and-Execute MUST execute no more than eight steps in one run.
- **FR-011**: The arena MUST allow one or more strategies to run against the same input and print each answer, trace, and metric.
- **FR-012**: The arena MUST accept strategy selection and maximum iteration options and MUST reject malformed options with an actionable error.
- **FR-013**: Tests for store behavior and trace formatting MUST be deterministic and MUST NOT require network access.
- **FR-014**: Strategy iteration limits MUST bound repeated model/agent work, and LLM-call metrics MUST count every model invocation made by a strategy.

### Key Entities *(include if feature involves data)*

- **Service**: A monitored service that incidents and alerts refer to.
- **Alert**: A monitoring signal associated with a service and a firing or resolved status.
- **Incident**: An operational record with an identifier, title, service, severity, and resolution state.
- **Strategy result**: The answer returned by one strategy, its ordered trace, and its metrics.
- **Trace event**: A typed record of a reasoning thought, action, observation, plan, critique, or answer; action records also contain tool name and arguments.
- **Seed baseline**: The predictable set of five services and six alerts used to exercise the tools.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A single arena run can return results for every selected strategy using the same supplied input.
- **SC-002**: Every completed strategy result includes an answer, an ordered trace, an LLM-call count, and elapsed milliseconds.
- **SC-003**: The seed baseline contains exactly five services and six alerts, split evenly between firing and resolved.
- **SC-004**: ReAct never exceeds its configured iteration limit, and Plan-and-Execute never executes more than eight steps.
- **SC-005**: Store and trace-formatting tests pass repeatedly with identical results and without external network access.
- **SC-006**: Missing model configuration, invalid inputs, and unknown incident references produce explicit errors rather than silent defaults or false success.

## Assumptions

- The system is an operator/developer-facing prototype; authentication and production deployment are outside this feature.
- The six seeded alerts are varied by service and alert details; the exact values are implementation fixtures, while counts and statuses are fixed.
- The requested implementation constraints are carried into planning: Node.js 22, TypeScript ESM, LangChain/LangGraph, OpenRouter, Zod, Sequelize/MySQL, and `node:test` via `tsx`.
- Keep the requested module boundaries: model factory in `src/llm/model.ts`, tools in `src/tools/` (one file per tool, assembled in `src/tools/index.ts`), ReAct in `src/strategies/react.ts`, Plan-and-Execute in `src/strategies/plan-and-execute.ts`, and the arena in `src/arena.ts`.
- The model factory reads `OPENROUTER_API_KEY` and `OPENROUTER_MODEL`, uses OpenRouter's API base URL, and sets temperature to zero.
- The tool names are `list_alerts(status)`, `open_incidente(title, service, severity)`, and `resolve_incident(id)`; validate their arguments with Zod.
- ReAct uses the prebuilt ReAct agent. Plan-and-Execute is a graph whose planner returns structured steps, executor performs one step at a time, and replanner chooses whether to adjust, continue, or finish; the plan has a maximum of eight actions.
- The arena accepts `--strategies` and `--max-iterations` options. Add a runnable seed script and execute it after implementation.
- The initial prototype uses `data/ops-store.json` as the reproducible baseline loaded into isolated in-memory stores. Sequelize/MySQL models remain in the project, but the current seed and tests do not require a MySQL server.
- Plan-and-Execute keeps completed operations as `[step, result]` pairs and asks its replanner to adjust, continue, or finish after each executed action, never exceeding eight actions.
- OpenRouter calls require valid environment configuration and network access; tests for store behavior and trace formatting do not.
- The arena is a local command-line interface using the existing project scripts and does not add a separate HTTP user interface.
- Seed execution is repeatable and leaves the baseline with the required service/alert counts rather than accumulating duplicate seed records.
