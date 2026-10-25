# Implementation Plan: Unified Production Graph

**Branch**: `013-unified-production-graph` | **Date**: 2026-10-19 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/013-unified-production-graph/spec.md`

## Summary

Move the `/chat` turn into a LangGraph production graph (`src/graph/production-graph.ts`)
with nodes `context` (history/summary/memory/budgeted context from features 011/012),
`router` (structured `{ route, reason }` with a routing table in the prompt, override and
fallback), the three strategy nodes (`react`, `plan-and-execute`, `reflection` = reflection
over ReAct) and `response`. Every trace event in a chat response carries `node`; a new
`route` event records route, reason and source. `strategy` becomes an optional override.
See [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript ESM (`strict: true`) on Node.js 22 LTS

**Primary Dependencies**: `@langchain/langgraph` (`StateGraph`, `StateSchema`, conditional edges), `@langchain/openai` via `createModel()` + `withStructuredOutput`, Zod 4, Express 5

**Storage**: unchanged (SQLite conversation/summary/memory stores)

**Testing**: `node:test` via `tsx`; fake router (`tests/helpers/fake-router.ts`) and fake strategies; no real model calls

**Target Platform**: Local Node.js HTTP server

**Project Type**: Single-project web service

**Performance Goals**: at most one extra model call per routed turn; zero on override turns

**Constraints**: router failure never fails the turn; unknown strategy still 422 before running; arena/bench/MCP untouched

**Scale/Scope**: 2 new modules (`router.ts`, `production-graph.ts`), trace schema + server changes, ~3 test files

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment | Status |
|-----------|------------|--------|
| I. MVC e efeitos controlados | Controller parses/validates, invokes the graph, persists; graph nodes are the service layer; request→route mapping, trace tagging and metric merging are pure helpers. | PASS |
| II. Contratos Zod | `routeDecisionSchema` validates untrusted model output; request schema, trace schema (node/route) and response refinement validated at the edge. | PASS |
| III. Erros explícitos | Unknown strategy → `UnknownStrategyError` (422); router failure is explicit (`source: "fallback"` + log), not hidden. | PASS |
| IV. Testes | Fake router + fake strategies; tests for routes, override, fallback, node tagging, ordering, metrics. | PASS |
| V. Segurança / Spec Kit | Router reason redacted with `sanitizeTraceText`; no secrets; spec → plan → tasks. | PASS |

Post-design re-check: all PASS.

## Project Structure

### Documentation (this feature)

```text
specs/013-unified-production-graph/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/chat-routing.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── graph/
│   ├── router.ts             # NEW: routes, routeDecisionSchema, ROUTER_PROMPT (table), createLlmRouter, routeFromRequest
│   └── production-graph.ts   # NEW: StateGraph context → router → strategies → response
├── trace/trace.ts            # graphNodeSchema, optional node on all events, route event
└── http/server.ts            # optional strategy, router option, graph invocation

tests/
├── helpers/fake-router.ts           # NEW
├── graph/router.test.ts             # NEW
├── graph/production-graph.test.ts   # NEW
└── http/server.test.ts              # inject fake router; override/legacy/422 tests
```

**Structure Decision**: New `src/graph/` folder for the production graph and router; the
context stage reuses `prepareConversationHistory` and `buildContext`; strategies are resolved
through the existing `StrategyRegistry`.

## Complexity Tracking

No constitution violations to justify.
