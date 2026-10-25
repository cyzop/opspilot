# Implementation Plan: War Room Web

**Branch**: `016-war-room-web` | **Date**: 2026-10-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/016-war-room-web/spec.md`

## Summary

A new front-end project in `web/` (Vite 8 + React 19 + TypeScript strict, `base: "/opspilot/"`)
gives the operator a war room: a chat bound to `POST /chat`, a "ver raciocínio" toggle that
renders the typed trace (one view per event kind, unknown kinds as a generic step), an approval
card for `202` results and a gear dialog to set, test and save the API URL. Every API response
is validated with Zod in a pure client module before it reaches a component.

On the API, three additions:

1. **Approval gate for `resolve_incident` only.** `/chat` runs the graph inside an
   `AsyncLocalStorage` approval policy. Under that policy the `resolve_incident` tool does not
   run; it throws `ApprovalRequiredError` with the proposed call. ReAct uses a small `ToolNode`
   subclass that rethrows that error (every other tool error still becomes a `ToolMessage`),
   plan-and-execute rethrows it from its step loop, and the production graph never treats it as
   a strategy failure (no ReAct fallback). The error carries the partial trace. `/chat` stores a
   pending approval (SQLite `approvals`, 15 min expiry) and answers **202** with the approval,
   trace and metrics. CLI and MCP never set the policy, so they keep running the tool directly.
2. **Decision endpoint.** `POST /approvals/:id/decision` (`approve` | `deny`) claims the
   pending row atomically (`UPDATE … WHERE status='pending' AND expires_at > now`). Approve runs
   the resolution once through `OpsService`; deny runs nothing. Either way the turn finishes
   deterministically (no extra model call): the answer, an `approval` trace event and the tool's
   observation are returned, appended to the conversation and recorded as a request.
   `GET /approvals/:id` lets the page restore a card after a reload.
3. **CORS.** A small pure-policy middleware allows only `OPSPILOT_CORS_ORIGINS` (default
   `http://localhost:5173`), answers preflight with 204, exposes `X-Request-Id` and never sends
   `*`.

See [research.md](./research.md) for decisions and rejected alternatives.

## Technical Context

**Language/Version**: TypeScript (`strict: true`) — API on Node.js 22 LTS (ESM); web on Vite 8 + React 19 (browser, ES2022)

**Primary Dependencies**: API: Express 5, Zod 4, `@langchain/langgraph` 1.4 (`ToolNode` subclass), `node:sqlite`, `node:async_hooks`. Web: `vite`, `@vitejs/plugin-react`, `react`, `react-dom`, `zod`; dev: `jsdom`, `global-jsdom`, `@testing-library/react`, `axe-core`, `tsx`, `typescript`

**Storage**: API: new SQLite table `approvals` in the `OPSPILOT_DB` file (`:memory:` in tests). Web: `localStorage` key `opspilot.apiUrl` (wrapped in try/catch; default used when unavailable)

**Testing**: `node:test` via `tsx` in both projects. API: fake models/strategies, injectable clock and approval executor. Web: pure modules (API client parsing, trace view model, settings validation, chat reducer, colour-contrast of the token palette) plus component tests on `jsdom` with Testing Library and `axe-core`

**Target Platform**: API: local Node.js HTTP server. Web: evergreen browsers, served as static files under `/opspilot/`

**Project Type**: Web application (existing backend in `src/` + new frontend in `web/`)

**Performance Goals**: no extra model calls for approval decisions; the war room's first render needs no API call

**Constraints**: no state change from `resolve_incident` without a recorded approval when called through `/chat`; CLI/MCP behaviour unchanged; model/tool text rendered as text only (no `dangerouslySetInnerHTML`); CORS never `*`; existing `/chat` 200/4xx/5xx contracts unchanged; layout works from 320px; design rules in `.claude/rules/design.md`

**Scale/Scope**: one page, ~10 components; 3 new API routes plus CORS; one new trace event kind (`approval`)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How the plan complies |
|-----------|--------|-----------------------|
| I. MVC and controlled effects | ✅ | API: `ApprovalStore` (model), `approval-service.ts` pure functions for the decision outcome (service), routes in `server.ts` (controller); CORS policy is a pure function, the middleware only applies it. Web: `lib/` pure modules (api parsing, trace view model, reducer, settings), `api/` for `fetch`, components only render |
| II. Zod contracts | ✅ | API: request/response schemas for `/chat` 202, `/approvals/:id`, decision body and response; `OPSPILOT_CORS_ORIGINS` parsed with Zod. Web: every response parsed with Zod in `lib/api-schemas.ts` before use; settings URL validated with Zod |
| III. Explicit errors | ✅ | `ApprovalRequiredError` (control flow → 202), `UnknownApprovalError` (404), `ApprovalNotPendingError` (409); translated in `classifyChatError` / route handlers. Web maps failures to a typed `ApiError` kind (network, cors-or-network, timeout, http, invalid-response) |
| IV. Tests and quality | ✅ | `node:test` via `tsx` in both projects (no Vitest/Jest); `npm test` and `npm run typecheck` green at the root and in `web/` |
| V. Security and spec-driven | ✅ | No secrets in the web build; API URL is user config; CORS allow-list; resolution needs approval through HTTP; spec → plan → tasks → implement |
| Stack | ⚠️ justified | New `web/` project adds Vite/React (requested by the user). Root stack untouched; see Complexity Tracking |

Post-design re-check (after Phase 1): ✅ no new violations — contracts and data model keep the
same layering; the `approval` trace event is additive to the existing union.

## Project Structure

### Documentation (this feature)

```text
specs/016-war-room-web/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── http-api.md      # 202 body, approvals routes, CORS
│   └── web-ui.md        # screens, states, components, a11y contract
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── approval/
│   ├── approval-context.ts     # AsyncLocalStorage policy: runWithApprovalPolicy, approvalRequired()
│   ├── approval-errors.ts      # ApprovalRequiredError (+ partial trace), UnknownApprovalError, ApprovalNotPendingError
│   ├── approval-store.ts       # schemas + ApprovalStore interface
│   ├── sqlite-approval-store.ts
│   └── approval-service.ts     # pure: describe proposal, decision outcome (answer + trace events)
├── tools/resolve-incident.ts   # throws ApprovalRequiredError when the policy is active
├── strategies/approval-tool-node.ts  # ToolNode subclass that rethrows ApprovalRequiredError
├── strategies/react.ts, plan-and-execute.ts  # rethrow + attach partial trace
├── graph/production-graph.ts   # no strategy fallback on ApprovalRequiredError; prefix trace
├── trace/trace.ts              # new `approval` event kind
├── http/cors.ts                # pure policy + middleware
├── http/chat-errors.ts         # (unchanged mapping for others)
└── http/server.ts              # policy around graph.run, 202, /approvals routes, CORS

tests/
├── approval/*.test.ts
├── http/cors.test.ts, http/server.test.ts (202 + decisions)
└── strategies/*.test.ts (rethrow behaviour)

web/
├── package.json, tsconfig.json, vite.config.ts (base "/opspilot/"), index.html
├── src/
│   ├── main.tsx, App.tsx
│   ├── styles/tokens.ts + tokens.css   # spacing/type scales, semantic colours (light/dark)
│   ├── lib/                            # pure, tested with node:test
│   │   ├── api-schemas.ts              # Zod: chat 200/202/error, approval, decision
│   │   ├── api-client.ts               # fetch wrapper → typed result (fetch injected)
│   │   ├── chat-state.ts               # reducer: turns, pending, conversationId
│   │   ├── trace-view.ts               # event → {label, icon, fields}; unknown → generic
│   │   ├── settings.ts                 # URL validation, load/save with storage fallback
│   │   └── contrast.ts                 # WCAG contrast ratio
│   └── components/
│       ├── ChatView.tsx, Composer.tsx, Turn.tsx, EmptyState.tsx, ErrorNotice.tsx
│       ├── TraceToggle.tsx, TraceList.tsx, TraceEventItem.tsx, MetricsSummary.tsx
│       ├── ApprovalCard.tsx
│       ├── SettingsDialog.tsx, ThemeToggle.tsx
└── tests/                              # node:test via tsx (+ global-jsdom for components)
```

**Structure Decision**: Option 2 (web application). The API stays at the repository root
(`src/`, `tests/`); the war room is a separate npm project in `web/` with its own
`package.json`, `tsconfig.json` and scripts, so the root `tsc`/`npm test` globs do not change.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Second npm project (`web/`) with Vite + React | User asked for a Vite + React + TS war room; it has a browser build and different `tsconfig` (DOM, JSX) | Serving hand-written HTML from Express would not meet the requested stack or the `/opspilot/` static deploy |
| `ToolNode` subclass | Prebuilt `ToolNode` turns every tool error into a `ToolMessage`, so the model would keep going after an approval request | `handleToolErrors: false` would crash the turn on ordinary tool errors; LangGraph `interrupt()` needs a checkpointer and resumable nested graphs (see research R1) |
