# Implementation Plan: Model Resilience

**Branch**: `014-model-resilience` | **Date**: 2026-10-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/014-model-resilience/spec.md`

## Summary

The model factory in `src/llm/model.ts` stops returning a bare `ChatOpenAI` and returns a
`ResilientChatModel` (a `BaseChatModel` subclass) that wraps the primary model and the
optional reserve (`OPENROUTER_MODEL_FALLBACK`). Every call it serves — plain `invoke`, and
the runnables returned by `bindTools` (ReAct) and `withStructuredOutput` (router,
planner, critic) — is built per call as
`primary.withRetry({ stopAfterAttempt: 2 })` `.withFallbacks([reserve.withRetry({ stopAfterAttempt: 2 })])`,
with the internal `ChatOpenAI` retries turned off (`maxRetries: 0`). A switch to the
reserve is reported through a small `AsyncLocalStorage` recorder; the production graph
wraps each node so the report becomes a `fallback` trace event tagged with that node.
`metrics.modelUsed` is derived from the trace. When nothing works, the factory throws
`ModelUnavailableError`; the existing auxiliary fallbacks still absorb it in the router,
summarizer and non-ReAct strategies, and `POST /chat` translates it to **503** without
persisting the exchange. See [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript ESM (`strict: true`) on Node.js 22 LTS

**Primary Dependencies**: `@langchain/core` 1.2.14 (`BaseChatModel`, `Runnable.withRetry`, `Runnable.withFallbacks`), `@langchain/openai` 1.6.2 (`ChatOpenAI`, `maxRetries: 0`), `@langchain/langgraph` 1.4.18 (production graph, `createReactAgent`), `node:async_hooks` (`AsyncLocalStorage`), Zod 4, Express 5

**Storage**: unchanged (SQLite conversation, summary and memory stores); a 503 turn writes nothing

**Testing**: `node:test` via `tsx`; scripted fake chat model (`tests/helpers/fake-chat-model.ts`) injected through the factory's `buildChatModel` option; existing fake router/strategies/summarizer; no real provider calls

**Target Platform**: Local Node.js HTTP server, arena/bench CLIs, MCP server

**Project Type**: Single-project web service

**Performance Goals**: zero overhead on a healthy primary; worst-case added latency before the reserve is about 1–2 s per call, and again on the reserve (LangChain's fixed backoff, 2 attempts per model)

**Constraints**: turn timeout (180 s, 504) unchanged; non-transient errors are not retried; `StrategyLimitError`, `ConfigurationError` and aborts never trigger retry or reserve; failure reasons redacted with `sanitizeTraceText`

**Scale/Scope**: 2 new modules (`src/llm/model-errors.ts`, `src/llm/model-events.ts`), factory rewrite, trace schema + graph + server changes, type annotations `ChatOpenAI` → `BaseChatModel` in 3 call sites, ~4 test files

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment | Status |
|-----------|------------|--------|
| I. MVC e efeitos controlados | Settings parsing (`readModelSettings`), error classification (`classifyModelError`) and `resolveModelUsed` are pure functions. Provider I/O stays inside the factory; the `AsyncLocalStorage` recorder is an edge concern used only by the factory and the graph node wrapper. Controller only maps the error to 503. | PASS |
| II. Contratos Zod | Env settings parsed with a Zod schema; new `fallback` trace event and `metrics.modelUsed` validated in `traceEventSchema` and `chatResponseSchema`. Model output is still validated by existing schemas at each call site. | PASS |
| III. Erros explícitos | New `ModelUnavailableError` (domain error, `OpsPilotError` subclass) translated to 503 only in `src/http/server.ts`. The reserve switch is visible (`fallback` event + log), never silent. | PASS |
| IV. Testes | Scripted fake model covers retry recovery, reserve with event, healthy primary, no reserve, reserve = primary, both failing → 503 with no persistence, auxiliary fallbacks preserved. `npm test` / `npm run typecheck` stay green. | PASS |
| V. Segurança / Spec Kit | `OPENROUTER_MODEL_FALLBACK` added to `.env.example` only (no values); reasons and 503 body never include provider error text unredacted; `.env` not read manually. Spec → plan → tasks. | PASS |

Post-design re-check (after Phase 1): all PASS. No violations, Complexity Tracking empty.

## Project Structure

### Documentation (this feature)

```text
specs/014-model-resilience/
├── plan.md              # This file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   └── chat-model-resilience.md
├── checklists/
└── tasks.md             # Phase 2 (/speckit-tasks, not created here)
```

### Source Code (repository root)

```text
src/
├── llm/
│   ├── model.ts             # readModelSettings, createModel → ResilientChatModel (retry + reserve)
│   ├── model-errors.ts      # NEW: classifyModelError (pure)
│   └── model-events.ts      # NEW: AsyncLocalStorage recorder for model fallbacks
├── domain/errors.ts         # + ModelUnavailableError
├── trace/trace.ts           # + "fallback" event type (+ "fallback" reason redaction)
├── graph/
│   ├── production-graph.ts  # wrap nodes with recorder, tag fallback events, metrics.modelUsed
│   └── router.ts            # ChatOpenAI type → BaseChatModel
├── strategies/
│   ├── plan-and-execute.ts  # ChatOpenAI type → BaseChatModel
│   └── reflection.ts        # ChatOpenAI type → BaseChatModel
├── http/server.ts           # ModelUnavailableError → 503; modelUsed in response; startup notice
└── (react.ts, llm-history-summarizer.ts, arena.ts, bench.ts, mcp/server.ts: no code change)

tests/
├── helpers/fake-chat-model.ts   # NEW: scripted fake BaseChatModel (fail N times / always)
├── llm/model.test.ts            # settings, retry, reserve, classification, no reserve
├── llm/model-events.test.ts     # NEW: recorder scoping
├── graph/production-graph.test.ts  # fallback event tagging, modelUsed, auxiliary fallbacks
└── http/server.test.ts          # 503 + no persistence, modelUsed in 200 response

.env.example                     # + OPENROUTER_MODEL_FALLBACK=
```

**Structure Decision**: Single project. Resilience lives in the LLM layer (`src/llm/`) so
every consumer of `createModel()` — chat, arena, bench, MCP — gets it without changes;
only the graph (trace/metrics) and the HTTP edge (503) know about it.

## Complexity Tracking

No constitution violations.
