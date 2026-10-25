# Research: Unified Production Graph

Resolved from the repository (LangGraph `StateGraph`/`StateSchema` already used by
`plan-and-execute.ts`; usage recorder from feature 010; context stage from 011/012).
No new dependencies.

## R1. Graph shape

- **Decision**: `src/graph/production-graph.ts` builds a LangGraph `StateGraph` with nodes
  `context` → `router` → conditional edge to `react` | `plan-and-execute` | `reflection` →
  `response` → END. Compiled once per `createChatServer`; invoked per turn inside the existing
  `withRequestTimeout`.
- **Rationale**: Same library and state style (`StateSchema` + Zod) as Plan-and-Execute;
  conditional edges map 1:1 to the route decision; nodes are named exactly as the trace
  `node` values.
- **Alternatives**: plain `switch` in the controller — loses the explicit graph the user
  asked for and the per-node attribution.

## R2. Graph state

`{ message, conversationId?, userId?, requestedRoute?, prepared (history/summary/event),
memories, built (prompt/sections/report), decision, routerUsage, result, trace }`. Nodes
return partial updates; `trace` uses a concat reducer so each node appends its own events
already tagged with `node`.

## R3. Router

- **Decision**: `src/graph/router.ts`: `routeDecisionSchema = z.object({ route:
  z.enum(["react","plan-and-execute","reflection"]), reason: z.string().trim().min(1).max(300)
  }).strict()`; default `createLlmRouter()` uses `createModel().withStructuredOutput(schema)`
  with `ROUTER_PROMPT` containing a markdown routing table; invoked with the built context
  and per-run usage callbacks (feature 010 recorder). Type: `Router = (input: string,
  callbacks: readonly UsageCallback[]) => Promise<unknown>`; output validated with the schema.
- **Routing table** (in the prompt):

  | route | use when |
  |-------|----------|
  | react | direct question answerable with 1–3 lookups (status, list alerts/incidents, runbook) |
  | plan-and-execute | multi-step operational task with several actions (triage several alerts, open/resolve multiple incidents) |
  | reflection | judgment or high-stakes answer that benefits from verification (recommendations, root cause, decisions) |

- **Override**: when `requestedRoute` exists the router node does not call the model and
  emits `route` with `source: "override"`, reason `"Strategy requested by the caller."`.
- **Fallback**: router error or schema failure → `route: "react"`, `source: "fallback"`,
  reason `Router failed: <redacted message>` (truncated to 300 chars); `console.error`.

## R4. Strategy nodes

- `react` → `registry.resolve("react")`, `plan-and-execute` → `registry.resolve("plan-and-execute")`,
  `reflection` → `registry.resolve("react", true, 2)` (reflection over ReAct). Each node runs
  `strategy.run(built.prompt)` and tags every returned trace event with its node name.
- The registry interface is unchanged, so fake registries in tests keep working.

## R5. Request mapping

`strategy` optional, no default. Mapping to `requestedRoute`:
`react` → react; `plan-and-execute` → plan-and-execute; `reflection` → reflection;
`reflect:<x>` (x ∈ react|plan-and-execute) → reflection; `reflect: true` with or without
`strategy` → reflection; anything else → `UnknownStrategyError` (422) **before** the graph runs.

## R6. Trace `node` field and `route` event

- `graphNodeSchema = z.enum(["context","router","react","plan-and-execute","reflection","response"])`.
- Every variant of `traceEventSchema` gains `node: graphNodeSchema.optional()` (strategies,
  arena and bench keep emitting events without it); `chatResponseSchema` refines the trace so
  every event has `node`.
- New variant `{ type: "route", content, route, reason, source: "router"|"override"|"fallback",
  node? }` (strict). `content` = `Route <route> (<source>): <reason>`.
- Order: `summarize` (context) → `route` (router) → strategy events (strategy node).

## R7. Metrics

`llmCalls = strategy.llmCalls + (router model invoked ? 1 : 0)`;
`promptTokens = sumPromptTokens([strategy.promptTokens ?? null, routerRecorder.promptTokens()])`
only when the router was invoked (otherwise strategy value). Override turns therefore keep
today's metrics. Fake routers in tests emit no usage, so routed test turns report `null`
promptTokens — documented, and tests needing a number use an override.

## R8. Response node and side effects

The `response` node assembles `{ answer, trace, metrics }` (pure). Persisting the exchange
and the async learning reflector stay in the controller after the graph returns, as today.

## R9. Tests without a real model

`ChatServerOptions.router` is injectable; `tests/helpers/fake-router.ts` provides
`createFakeRouter(route | (input) => decision | Error)` recording calls. Existing server
tests that send no `strategy` get a fake router (default `react`) via a local helper so
`npm test` never reaches OpenRouter.
