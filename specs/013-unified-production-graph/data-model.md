# Data Model: Unified Production Graph

No persisted data.

## GraphNode

`"context" | "router" | "react" | "plan-and-execute" | "reflection" | "response"`
(`graphNodeSchema`).

## Route / RouteDecision

| Field | Type | Rule |
|-------|------|------|
| route | `"react" \| "plan-and-execute" \| "reflection"` | enum only |
| reason | string | trimmed, 1–300 chars |
| source | `"router" \| "override" \| "fallback"` | set by the router node, not by the model |

Model output schema (`routeDecisionSchema`): `{ route, reason }` strict.

## Trace event changes

- All existing variants: optional `node: GraphNode`.
- New variant `route`: `{ type: "route", node?: GraphNode, content: string, route, reason, source }` strict.
- Chat responses: every event MUST have `node` (refinement in `chatResponseSchema`).

## ProductionGraphState

| Field | Type | Set by |
|-------|------|--------|
| message | string | input |
| conversationId | string \| undefined | input |
| userId | string \| undefined | input |
| requestedRoute | Route \| undefined | input (mapped from request) |
| historyMessages | number | context |
| built | BuiltContext (feature 012) | context |
| decision | RouteDecision | router |
| routerCalls | 0 \| 1 | router |
| routerPromptTokens | number \| null | router |
| result | StrategyResult | strategy node |
| trace | TraceEvent[] (concat reducer) | every node |
| output | `{ answer, trace, metrics }` | response |

## ChatRequest (changed)

| Field | Change |
|-------|--------|
| strategy | optional, no default; accepted: `react`, `plan-and-execute`, `reflection`, `reflect:react`, `reflect:plan-and-execute` |
| reflect | still accepted; `true` → route `reflection` |

## ChatServerOptions (changed)

Adds `router?: Router` (default LLM router).
