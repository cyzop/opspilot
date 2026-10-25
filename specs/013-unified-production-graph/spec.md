# Feature Specification: Unified Production Graph

**Feature Branch**: `013-unified-production-graph`

**Created**: 2026-10-19

**Status**: Draft

**Input**: User description: "Grafo unificado: production-graph.ts: nós contexto, roteador, as 3 estratégias como nós e resposta. roteador: withStructuredOutput (route, reason); tabela no prompt; evento \"route\" e campo node em todo evento de trace. /chat: strategy opcional (se vier, é override no trace)"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The assistant picks the right reasoning strategy automatically (Priority: P1)

As an on-call operator, I want to just send my question and have OpsPilot choose the most suitable reasoning strategy (direct tool use, multi-step planning, or answer-with-verification), so that I get a good answer without knowing which strategy to request.

**Why this priority**: Today the caller must pick a strategy (defaulting to direct tool use). Automatic routing is the core value of the unified graph.

**Independent Test**: With a scripted (fake) router, send three questions that the router assigns to each of the three strategies; verify each turn runs only the chosen strategy and the response trace starts with a `route` event naming it and the reason.

**Acceptance Scenarios**:

1. **Given** a chat request without a strategy, **When** the turn is processed, **Then** the request flows through the stages context → router → chosen strategy → response, and only the chosen strategy runs.
2. **Given** the router returns a route and a reason, **When** the response is returned, **Then** the trace contains exactly one `route` event with the chosen route, the reason, and an indication that it was decided by the router.
3. **Given** the router's decision guide (a table of routes and when to use each), **When** the router decides, **Then** it can only select one of the three listed routes; any other value is rejected.

---

### User Story 2 - The caller can still force a strategy, visibly (Priority: P1)

As a developer comparing strategies, I want to keep requesting a specific strategy, and see in the trace that the route was overridden by me rather than chosen by the router, so that experiments remain possible and auditable.

**Why this priority**: Existing clients and the course's comparisons rely on choosing strategies explicitly; silently ignoring that would break them.

**Independent Test**: Send a request with `strategy` set; verify the router is not consulted, the requested strategy runs, and the `route` event marks the route as an override with the requested value.

**Acceptance Scenarios**:

1. **Given** a chat request with a valid strategy, **When** the turn is processed, **Then** the router is skipped, that strategy runs, and the `route` event records the route as an override.
2. **Given** a chat request with an unknown strategy, **When** it is processed, **Then** it is rejected exactly as today (unprocessable request) and no strategy runs.
3. **Given** a legacy request that asks for verification of a strategy (the existing reflection flag or prefix), **When** it is processed, **Then** it is treated as an override to the verification route.

---

### User Story 3 - Every trace step says which stage produced it (Priority: P2)

As someone inspecting responses, I want every trace event to carry the name of the stage that produced it, so that I can follow the path of a turn through the graph.

**Why this priority**: Observability of the new flow; builds on stories 1–2.

**Independent Test**: For a routed turn and an overridden turn, verify that every trace event has a stage name: history summarization events come from the context stage, the route event from the router stage (or override), and strategy events from the strategy stage that ran.

**Acceptance Scenarios**:

1. **Given** any successful chat response, **When** its trace is inspected, **Then** every event has a non-empty stage name from the fixed set: context, router, react, plan-and-execute, reflection, response.
2. **Given** a turn in which history was summarized, **When** the trace is inspected, **Then** the `summarize` event is attributed to the context stage and appears before the `route` event.
3. **Given** a turn routed to the verification strategy, **When** the trace is inspected, **Then** the base reasoning events and the critique events are attributed to the reflection stage.

---

### Edge Cases

- The router call fails, times out, or returns an invalid or unknown route: the turn still completes using the direct tool-use strategy, and the `route` event records the route as a fallback with the failure reason (redacted); the failure is also logged. No hidden success.
- The router returns an empty or overly long reason: the reason is required, trimmed, and capped in length; an empty reason is treated as an invalid router output (fallback).
- Both `strategy` and the legacy reflection flag are sent: the request is treated as an override to the verification route.
- Arena and bench, which compare strategies explicitly, keep running strategies directly and are not routed.
- The router counts as a model call of the turn: it is included in the turn's model-call count and real prompt-token usage (feature 010).
- Per-section context budgets (feature 012) and history summarization (feature 011) keep working unchanged inside the context stage.
- Unknown conversation, invalid body and timeout responses keep today's status codes.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Each chat turn MUST be processed by a single production graph with the stages: context, router, three strategy stages (direct tool use "react", multi-step "plan-and-execute", verification "reflection"), and response.
- **FR-002**: The context stage MUST perform the existing per-turn preparation (history loading and summarization, memory recall, budgeted context assembly) before routing.
- **FR-003**: When no strategy is requested, the router stage MUST choose exactly one route among `react`, `plan-and-execute` and `reflection`, returning a validated structured result with the route and a non-empty reason.
- **FR-004**: The router's instructions MUST include a decision table listing each route and when to use it; the route value MUST be constrained to the three listed routes.
- **FR-005**: When a strategy is requested, the router MUST be skipped and the requested route used; the decision MUST be recorded as an override.
- **FR-006**: The response trace MUST include one `route` event for the routing decision, containing the route, the reason, and the decision source (`router`, `override` or `fallback`); a second `route` event appears only when the chosen strategy fails and the turn falls back (FR-015).
- **FR-007**: Every trace event in a chat response MUST carry a `node` field naming the stage that produced it, from the fixed set: context, router, react, plan-and-execute, reflection, response.
- **FR-008**: If the router fails or returns invalid output, the turn MUST continue with the `react` route, record the decision source as `fallback` with a redacted reason, and log the failure.
- **FR-009**: The `strategy` field of the chat request MUST become optional with no default; when provided it MUST accept `react`, `plan-and-execute` and `reflection`, plus the existing legacy forms that request verification (reflection flag, `reflect:` prefix), which map to `reflection`. Unknown values MUST be rejected with today's status code.
- **FR-010**: The verification route MUST apply the existing verification behavior on top of the direct tool-use strategy.
- **FR-011**: The router's model call MUST be counted in the turn's model-call count and in the real prompt-token metric when the provider reports usage.
- **FR-012**: Arena and bench MUST keep invoking strategies directly, without routing.
- **FR-013**: Routing decisions MUST be testable with a replaceable router so tests never call a real model.
- **FR-015**: If the `plan-and-execute` or `reflection` strategy fails, the turn MUST re-run with `react`, add a `route` event with `route: react`, `source: fallback`, a redacted reason starting with `Strategy <route> failed`, attributed to the failing strategy node, and log the failure; a failing `react` strategy is not retried and fails the turn as before. (Added after a live run in which the planner's structured output came back empty and the turn returned HTTP 500.)
- **FR-014**: Automated tests MUST cover: each of the three routes chosen by a fake router; override skipping the router; legacy reflection forms; unknown strategy rejection; router failure and invalid output falling back to `react`; `node` on every trace event; event ordering (summarize before route before strategy events); router call counted in metrics.

### Key Entities

- **Route Decision**: route (react | plan-and-execute | reflection), reason (short text), source (router | override | fallback).
- **Graph Stage (node)**: one of context, router, react, plan-and-execute, reflection, response; every trace event references the stage that produced it.
- **Routing Table**: the documented guidance given to the router — each route with the kind of request it suits.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of chat responses contain a `route` event for the routing decision (plus one fallback `route` event only when the chosen strategy failed), and 100% of their trace events name the stage that produced them.
- **SC-002**: For requests without a strategy, exactly one strategy runs per turn; for requests with a strategy, the router is never consulted.
- **SC-003**: A router failure never fails a chat request; 100% of such turns return an answer with a `fallback` route event.
- **SC-004**: Existing clients that always send a strategy see no change other than the added `route` event and `node` fields.
- **SC-005**: Automatic routing adds at most one model call per turn.

## Assumptions

- The user named `production-graph.ts`, the router's structured output with `route` and `reason`, a decision table in the router prompt, the `route` trace event, the `node` field and the optional `strategy` override; the plan will honor them.
- The "3 strategies" are ReAct, Plan-and-Execute and Reflection; the reflection route wraps ReAct (the legacy `reflect:plan-and-execute` form also maps to the reflection route and therefore runs on ReAct).
- Default routing table: `react` for direct questions needing a few lookups (status, listing alerts or incidents); `plan-and-execute` for multi-step operational tasks with several actions (triage several alerts, open/resolve multiple incidents); `reflection` for high-stakes or judgment answers that benefit from verification (recommendations, root-cause conclusions, decisions).
- The router decides from the current message plus the budgeted context produced by the context stage, using the same configured model provider.
- The `route` event is placed after any `summarize` event and before strategy events; the response stage adds no event of its own unless needed later.
- The fallback route on router failure is `react` (today's default strategy), made explicit in the trace rather than hidden.
- Only the chat endpoint is routed; arena, bench and the MCP server are unchanged.
