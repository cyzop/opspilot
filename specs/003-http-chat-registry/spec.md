# Feature Specification: OpsPilot HTTP Chat Registry

**Feature Branch**: `003-http-chat-registry`

**Created**: 2026-10-09

**Status**: Draft

**Input**: User description: "POST /chat in src/http/server.ts (or Express default): body {message, strategy?, reflect?} validated with zod; default react. 200 {answer, trace, metrics}; 400 invalid body (zod issues); 422 unknown strategy; timeout 180s -> 504. Registry in src/agentes/index.ts (name -> strategy; reflect applies with Reflection). Integration test with deterministic fake strategy, without network."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Submit a chat request and receive a validated answer (Priority: P1)

As an OpsPilot operator, I want to send a single operational question to the system through a chat endpoint so that I can receive a complete answer with trace and metrics in a predictable format.

**Why this priority**: The chat endpoint is the primary way operators interact with the reasoning layer through HTTP.

**Independent Test**: Submit a valid payload with a deterministic fake strategy and verify the response includes the answer, ordered trace, and metrics with HTTP 200.

**Acceptance Scenarios**:

1. **Given** a request body containing a non-empty message and a supported strategy, **When** the operator posts to the chat endpoint, **Then** the service processes the request and returns HTTP 200 with an answer, trace, and metrics.
2. **Given** a request body with a valid message but no strategy field, **When** the request is submitted, **Then** the system uses the default strategy and returns the same shape as the explicit case.
3. **Given** a request body with invalid data, **When** it is validated, **Then** the endpoint returns HTTP 400 and reports the Zod validation issues rather than processing the request.

---

### User Story 2 - Choose the correct strategy and optional reflection path (Priority: P1)

As an OpsPilot operator, I want the system to resolve a strategy by name and apply reflection only when requested so that I can compare direct and reviewed reasoning behavior without confusing the default path.

**Why this priority**: Strategy selection is the operational control point for choosing the reasoning model and whether review/regeneration is enabled.

**Independent Test**: Resolve supported strategy names and a reflected request using a deterministic fake registry; verify the correct strategy instance is selected and wrapped when reflection is enabled.

**Acceptance Scenarios**:

1. **Given** the `react` strategy name, **When** the chat endpoint resolves it, **Then** the configured base strategy is executed with the submitted question.
2. **Given** the `plan-and-execute` strategy name, **When** the chat endpoint resolves it, **Then** the correct strategy is selected and the result follows the standard response contract.
3. **Given** a request with `reflect: true`, **When** the strategy is looked up, **Then** the strategy is wrapped with the reflection decorator and the reflected result is returned.
4. **Given** an unsupported strategy name, **When** the request is received, **Then** the endpoint returns HTTP 422 and prevents a silent fallback to another strategy.

---

### User Story 3 - Handle operational failures and time limits safely (Priority: P2)

As an operator, I want requests to fail clearly when validation fails, the strategy is unknown, or processing exceeds the allowed time so that operational workflows remain safe and diagnosable.

**Why this priority**: Safe error boundaries are essential for any production-facing HTTP service.

**Independent Test**: Trigger invalid payloads, unsupported strategies, and a delayed strategy call; verify the service returns 400, 422, and 504 respectively without external network calls.

**Acceptance Scenarios**:

1. **Given** a request that exceeds the 180-second processing budget, **When** the strategy call is still running, **Then** the endpoint returns HTTP 504 with a timeout outcome.
2. **Given** a request with a malformed body, **When** schema validation runs, **Then** it returns the detailed validation issues and does not attempt strategy execution.
3. **Given** a request that reaches an unsupported strategy name, **When** it is routed, **Then** it reports the actual unknown strategy clearly and stops before execution.

### Edge Cases

- The message is blank, missing, or too large for the request contract.
- The `strategy` field is provided with an unsupported value.
- The `reflect` field is present but not a boolean.
- The selected strategy or reflection wrapper fails before producing an answer.
- A strategy execution exceeds the request timeout budget after the request is accepted.
- The system receives duplicate or conflicting request fields in a malformed payload.
- A deterministic fake strategy is used in tests with no external network dependency.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST accept a chat request with a required `message` field and optional `strategy` and `reflect` fields.
- **FR-002**: When `strategy` is omitted, the system MUST default to `react`.
- **FR-003**: The system MUST validate the incoming request body with a schema and MUST reject malformed requests with HTTP 400 and the detailed validation issues.
- **FR-004**: The system MUST resolve supported strategy names through a single registry and MUST reject unknown names with HTTP 422.
- **FR-005**: The system MUST apply the reflection decorator only when `reflect` is explicitly enabled and MUST not change the default unreflected path.
- **FR-006**: Each successful chat response MUST include an `answer`, an ordered `trace`, and `metrics` in the standard response shape.
- **FR-007**: The system MUST enforce a maximum processing time of 180 seconds per request and MUST return HTTP 504 when the time budget is exceeded.
- **FR-008**: The system MUST preserve the existing reasoning result contract while exposing it through the HTTP boundary.
- **FR-009**: The system MUST surface actionable errors for invalid input, unsupported strategy, and timeout conditions without silently substituting a different strategy or result.
- **FR-010**: The system MUST support deterministic integration tests that validate the HTTP contract without invoking external model providers or networked services.
- **FR-011**: The registry MUST map strategy names to the corresponding strategy instances and MUST allow the reflected variant to be selected through the same routing contract.
- **FR-012**: The chat endpoint MUST remain compatible with the existing result semantics of the strategy layer so that operators receive the same operational trace and metrics information expected by the rest of the product.

### Key Entities

- **Chat request**: An operator message plus the optional strategy and reflection toggles that define how the request is processed.
- **Strategy registry**: A central lookup that resolves a supported strategy name to the correct strategy instance or reflected wrapper.
- **Strategy execution**: The selected reasoning strategy run, including its answer, trace, and metrics.
- **Response payload**: The HTTP contract returned to the operator with the final answer, trace, and metrics.
- **Operational failure**: A request-level validation, unsupported strategy, or timeout problem that must be translated to a clear HTTP response.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of valid chat requests return HTTP 200 and include `answer`, `trace`, and `metrics` in the same structural format.
- **SC-002**: 100% of invalid request bodies are rejected with HTTP 400 and Zod validation details before strategy execution begins.
- **SC-003**: 100% of unsupported strategy names are rejected with HTTP 422 and no alternative strategy is silently used.
- **SC-004**: Every request completes within the configured 180-second budget, and any overrun is reported as HTTP 504.
- **SC-005**: A reflected request produces an answer through the same public contract, while the unreflected default still works without changing the response shape.
- **SC-006**: Integration tests for the chat service validate request handling, strategy resolution, and timeout behavior without external network access.

## Assumptions

- The default strategy is `react` unless the caller explicitly selects a different supported strategy.
- Strategy names in the public request are case-sensitive and the service should reject unknown values instead of trying to coerce them.
- Reflection is opt-in and does not alter the successful response format for the caller.
- The HTTP boundary is responsible for translating validation and operational failures to clear status codes and messages.
- Deterministic fake strategies are sufficient for verifying the endpoint contract in tests while avoiding live model calls.

## Notes

This feature defines the HTTP entry point for the reasoning layer and the registry that resolves strategy names. It is intentionally scoped to request processing, validation, timeout handling, and strategy selection so that the underlying reasoning behavior remains the responsibility of the existing strategy and reflection contracts.
