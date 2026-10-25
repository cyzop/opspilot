---

description: "Task list for Unified Production Graph"
---

# Tasks: Unified Production Graph

**Input**: Design documents from `/specs/013-unified-production-graph/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/chat-routing.md, quickstart.md

**Tests**: Required by the spec (FR-013, FR-014) and constitution IV. Tests first; they must fail before the implementation. No test may call a real model (fake router + fake strategies).

**Organization**: US1 = automatic routing through the graph, US2 = strategy override and legacy forms, US3 = `node` on every trace event.

## Format: `[ID] [P?] [Story] Description`

- Paths are relative to the `ops-pilot/` project root

---

## Phase 1: Setup

- [X] T001 [P] Create `src/graph/router.ts` exporting `ROUTES = ["react", "plan-and-execute", "reflection"] as const`, `routeSchema = z.enum(ROUTES)`, `routeDecisionSchema = z.object({ route: routeSchema, reason: z.string().trim().min(1).max(300) }).strict()`, `routeSourceSchema = z.enum(["router", "override", "fallback"])`, types `Route`, `RouteDecision`, `RouteSource`, and `type Router = (input: string, callbacks: readonly UsageCallback[]) => Promise<unknown>`
- [X] T002 [P] Create `tests/helpers/fake-router.ts` exporting `createFakeRouter(behavior: Route | ((input: string) => unknown | Error) = "react")` returning `{ router, calls: string[] }`; a returned `Error` is thrown; a `Route` returns `{ route, reason: "fake router" }`

## Phase 2: Foundational

- [X] T003 Write failing tests in `tests/trace/trace.test.ts`: every existing event type accepts an optional `node` from `["context","router","react","plan-and-execute","reflection","response"]` and rejects other values; the new `route` event `{ type: "route", node: "router", content, route, reason, source }` validates and rejects unknown `route`/`source`
- [X] T004 Extend `src/trace/trace.ts`: `graphNodeSchema = z.enum(["context","router","react","plan-and-execute","reflection","response"])`; add `node: graphNodeSchema.optional()` to every variant of `traceEventSchema`; add the strict `route` variant `{ type: z.literal("route"), node?, content: z.string(), route: z.enum(["react","plan-and-execute","reflection"]), reason: z.string().trim().min(1).max(300), source: z.enum(["router","override","fallback"]) }`; keep `sanitizeTraceEvent`/`formatTrace` working (route reason redacted). Makes T003 pass
- [X] T005 Add a local helper in `tests/http/server.test.ts` so every existing `createChatServer(...)` call that does not send `strategy` gets `router: createFakeRouter("react").router` (prevents real router calls once routing lands); run `npm test` (still green)

---

## Phase 3: User Story 1 - Automatic routing (Priority: P1) 🎯 MVP

**Goal**: `/chat` without `strategy` runs context → router → chosen strategy → response.

**Independent Test**: A fake router choosing each route makes only that strategy run, and the trace has one `route` event with `source: "router"`.

### Tests (write first, must fail)

- [X] T006 [P] [US1] Create `tests/graph/router.test.ts`: `routeDecisionSchema` rejects `route: "other"`, empty/whitespace `reason` and reasons over 300 chars; `ROUTER_PROMPT` contains a table row for each of `react`, `plan-and-execute`, `reflection`; `decideRoute({ router, input })` returns `{ route, reason, source: "router", modelCalled: true }` for a valid fake output
- [X] T007 [P] [US1] Create `tests/graph/production-graph.test.ts` using `SqliteConversationStore(":memory:")`, a registry whose `resolve(name, reflect)` returns distinct fake strategies (react, plan-and-execute, reflection-wrapped react) that record calls: for each fake route, exactly the matching strategy runs; output trace contains exactly one `route` event with that route and `source: "router"`; `metrics.llmCalls` = strategy calls + 1
- [X] T008 [P] [US1] Add failing tests to `tests/graph/production-graph.test.ts`: router throwing an `Error("boom api_key=abc")` and router returning `{ route: "other" }` both run the react strategy, the `route` event has `source: "fallback"`, its reason starts with `Router failed` and does not contain `abc`; `console.error` called once (mock)

### Implementation

- [X] T009 [US1] In `src/graph/router.ts`, add `ROUTER_PROMPT` (pt-BR instructions + markdown table from research.md R3), `createLlmRouter(model?)` using `createModel().withStructuredOutput(routeDecisionSchema).invoke([SystemMessage(ROUTER_PROMPT), HumanMessage(input)], { callbacks })`, and `decideRoute({ router, input, requestedRoute?, callbacks })` returning `{ route, reason, source, modelCalled }` with override/fallback rules (fallback reason `Router failed: <sanitizeTraceText(message)>` truncated to 300, `console.error`). Makes T006 and T008's router part pass
- [X] T010 [US1] Create `src/graph/production-graph.ts`: `createProductionGraph({ registry, conversationStore, memoryStore?, summarizer, router, contextBudget })` building a `StateGraph` (state per data-model.md, `trace` with concat reducer) with nodes `context` (prepareConversationHistory + memory recall + buildContext; pushes `summarize` event tagged `node: "context"`), `router` (decideRoute with a per-run `createUsageRecorder`; pushes `route` event tagged `node: "router"`), `react` / `plan-and-execute` / `reflection` (`registry.resolve("react")`, `resolve("plan-and-execute")`, `resolve("react", true, 2)`; run `built.prompt`; tag every result event with the node name), `response` (assemble answer, trace, metrics: `llmCalls + (modelCalled ? 1 : 0)`, `promptTokens` merged with `sumPromptTokens` only when the router model was called, plus historyMessages/contextBreakdown/contextBudget); conditional edge from `router` on `decision.route`; export `runProductionGraph(graph, input)`. Makes T007–T008 pass
- [X] T011 [US1] In `src/http/server.ts`, add `router?: Router` to `ChatServerOptions` (default `createLlmRouter()`), compile the graph once in `createChatServer`, replace the inline context/strategy code with `runProductionGraph(...)` inside `withRequestTimeout`, keep persistence and the learning reflector after the graph; add a refinement to `chatResponseSchema` requiring `node` on every trace event
- [X] T012 [US1] Run `npm run typecheck` and `npm test`; change the "reports the real promptTokens" server test to send `strategy: "react"` (override keeps the strategy's usage)

**Checkpoint**: Routed turns work end to end with a fake router.

---

## Phase 4: User Story 2 - Override and legacy forms (Priority: P1)

**Independent Test**: With `strategy` set the fake router records zero calls and the `route` event has `source: "override"`; legacy reflection forms map to `reflection`; unknown values return 422.

### Tests (write first, must fail)

- [X] T013 [P] [US2] Add tests in `tests/graph/router.test.ts` for pure `routeFromRequest({ strategy?, reflect })`: `undefined/false` → `undefined`; `"react"` → `react`; `"plan-and-execute"` → `plan-and-execute`; `"reflection"`, `"reflect:react"`, `"reflect:plan-and-execute"`, `{ strategy: "react", reflect: true }`, `{ reflect: true }` → `reflection`; `"custom"` throws `UnknownStrategyError`
- [X] T014 [P] [US2] Add tests in `tests/http/server.test.ts`: request with `strategy: "plan-and-execute"` → fake router `calls.length === 0`, `route` event `source: "override"`, `route: "plan-and-execute"`; `strategy: "custom"` → 422 and no strategy ran; `reflect: true` → reflection route; request without `strategy` no longer defaults (router consulted once)

### Implementation

- [X] T015 [US2] In `src/graph/router.ts`, implement `routeFromRequest`; in `src/http/server.ts`, make `chatRequestSchema.strategy` optional without default, call `routeFromRequest` before running the graph (422 on unknown), and pass `requestedRoute` to the graph; in `decideRoute`, skip the router when `requestedRoute` is set (`source: "override"`, reason `Strategy requested by the caller.`, `modelCalled: false`). Makes T013–T014 pass; run `npm test`

---

## Phase 5: User Story 3 - `node` on every trace event (Priority: P2)

**Independent Test**: Routed and overridden turns (with a summarization) have `node` on every event, in the order summarize → route → strategy events; reflection critique events carry `node: "reflection"`.

### Tests (write first, must fail)

- [X] T016 [P] [US3] Add tests in `tests/graph/production-graph.test.ts`: conversation with 16 prior messages + fake summarizer → trace order `summarize(context)` → `route(router)` → strategy events; every event has `node`; a reflection-routed turn tags the base and `critique` events with `node: "reflection"`
- [X] T017 [P] [US3] Add a test in `tests/http/server.test.ts` asserting every trace event of several responses (routed, override, fallback) has a `node` from the fixed set

### Implementation

- [X] T018 [US3] Fill any gaps found by T016–T017 in `src/graph/production-graph.ts` (tagging helper `tagTrace(events, node)` pure, applied to context, router and strategy events); run `npm run typecheck` and `npm test`

---

## Phase 6: Polish

- [X] T019 [P] README section "Grafo de produção": nodes, routing table, `route` event, `node` field, optional `strategy` override, fallback
- [X] T020 [P] Note in `specs/012-context-budget-builder/contracts/context-budget.md` that the context stage of the production graph now owns the builder call (link to 013 contract)
- [X] T021 Constitution review: pure helpers (`routeFromRequest`, `tagTrace`, metric merge), Zod on router output, explicit fallback, no real model in tests (grep `createLlmRouter` absent from tests)
- [X] T022 Final gate: `npm run typecheck`, `npm test` (only pre-existing feature-009 failures may remain)

## Phase 7: Strategy failure fallback (added after live validation)

- [X] T023 [US1] Failing tests in `tests/graph/production-graph.test.ts`: `plan-and-execute` or `reflection` throwing → react runs, trace `route:router` → `route:<failing node>` (`route: react`, `source: fallback`, reason `Strategy <route> failed…`, redacted) → `answer:react`; failing react propagates
- [X] T024 [US1] Implement the fallback in `strategyNode` in `src/graph/production-graph.ts` (log, redact, re-run react, tag events)
- [X] T025 Update spec FR-006/FR-015/SC-001, `contracts/chat-routing.md` and `README.md`; run `npm run typecheck` and `npm test`

## Dependencies

Setup → Foundational (T003–T005) → US1 → US2 → US3 → Polish. US2 and US3 depend on the graph from US1 (T010). Tasks touching the same file (`production-graph.ts`, `server.ts`, `server.test.ts`) run sequentially; [P] tasks are in different files.

### Parallel Opportunities

- T001 ∥ T002
- T006 ∥ T007/T008 (different files)
- T013 ∥ T014
- T016 ∥ T017
- T019 ∥ T020

## Implementation Strategy

1. MVP: Setup + Foundational + US1 → routed graph with fallback
2. US2 → explicit override and legacy compatibility
3. US3 → full node attribution and ordering guarantees
4. Polish → docs and final gate
