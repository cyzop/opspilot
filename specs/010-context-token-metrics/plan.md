# Implementation Plan: Context Token Metrics

**Branch**: `010-context-token-metrics` | **Date**: 2026-10-19 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/010-context-token-metrics/spec.md`

## Summary

Instrument context size for each `/chat` turn. A new pure module `src/context/tokens.ts`
provides `estimateTokens` (chars/4, rounded up), validated extraction of LangChain's real
usage (`usage_metadata.input_tokens` from `handleLLMEnd`), a null-propagating sum and a
per-run usage recorder. Every strategy (ReAct, Plan-and-Execute, Reflection) attaches the
recorder through its per-invocation `callbacks` and reports `promptTokens` in its metrics.
The chat controller renders the prompt via a new `composeChatContext` that also returns the
rendered sections, estimates a `contextBreakdown` (history / memory / message / total) and
returns both in the Zod-validated response. `scripts/conversa-longa.sh` drives a multi-turn
conversation and prints `promptTokens` per turn. See [research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript ESM (`strict: true`) on Node.js 22 LTS

**Primary Dependencies**: `@langchain/core` 1.2.14 (callbacks, `LLMResult`), `@langchain/openai` 1.6.2 (OpenRouter via `ChatOpenAI`), `@langchain/langgraph` 1.4.x, Express 5, Zod 4

**Storage**: N/A — metrics are computed per response, not persisted

**Testing**: `node:test` via `tsx` (`npm test`), `tsc --noEmit` (`npm run typecheck`)

**Target Platform**: Local Node.js HTTP server; script runs in Bash (Git Bash on Windows) with `curl` and `node`

**Project Type**: Single-project web service + CLI tooling

**Performance Goals**: Estimation is O(characters) and negligible next to model latency; no extra model calls

**Constraints**: No new dependencies; no local tokenizer; strategies are shared singletons, so usage must be captured per run; backward-compatible metrics for existing callers/tests

**Scale/Scope**: ~1 new module, 3 strategies + 1 controller + 1 prompt composer touched, 1 shell script, ~5 test files

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment | Status |
|-----------|------------|--------|
| I. MVC e efeitos controlados | Estimation, usage extraction, sum and breakdown are pure functions in `src/context/tokens.ts`; the only effectful piece is the callback handler appending to a per-run array, attached at the model-call boundary inside strategies (Service). Controller (`server.ts`) only composes and returns. | PASS |
| II. Contratos Zod | Provider usage (untrusted external data) parsed with Zod; `strategyResultSchema` and `chatResponseSchema` extended and validated at the HTTP edge; script validates `TURNS`. | PASS |
| III. Erros explícitos | Missing/malformed usage becomes explicit `null`, never 0 or partial sum; script exits non-zero on failures; no new domain errors required, existing HTTP error translation unchanged. | PASS |
| IV. Testes | New `tests/context/tokens.test.ts` plus strategy, composer and server tests; typecheck/test must stay green. | PASS |
| V. Segurança / Spec Kit | No secrets; script does not read `.env`; usage capture records only numbers, never prompt content. Spec → plan → tasks flow followed. | PASS |

Post-design re-check (after Phase 1): unchanged — all PASS. No complexity deviations.

## Project Structure

### Documentation (this feature)

```text
specs/010-context-token-metrics/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── chat-metrics.md
│   └── conversa-longa-cli.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── context/
│   └── tokens.ts                 # NEW: estimateTokens, inputTokensFromLlmResult,
│                                 #      sumPromptTokens, createUsageRecorder,
│                                 #      estimateContextBreakdown, contextBreakdownSchema
├── http/
│   ├── compose-chat-prompt.ts    # composeChatContext (prompt + sections); composeChatPrompt wraps it
│   └── server.ts                 # metrics.promptTokens + metrics.contextBreakdown
├── strategies/
│   ├── react.ts                  # recorder.handler added to existing callbacks
│   ├── plan-and-execute.ts       # callbacks passed to planner/replanner invoke
│   └── reflection.ts             # combine base promptTokens + critic usage
└── trace/
    └── trace.ts                  # strategyResultSchema.metrics.promptTokens (optional, nullable)

scripts/
└── conversa-longa.sh             # NEW; package.json: "conversa-longa"

tests/
├── context/tokens.test.ts        # NEW
├── http/compose-chat-prompt.test.ts  # NEW
├── http/server.test.ts           # extended
└── strategies/{react,plan-and-execute,reflection}.test.ts  # extended
```

**Structure Decision**: Single project. Token logic lives in a new `src/context/` module as
requested by the user; it depends only on Zod and `@langchain/core` types, so strategies
(Service) and the HTTP controller can both import it without cycles.

## Design Notes

1. **Usage capture** (R1, R2): `createUsageRecorder()` returns
   `{ handler: { handleLLMEnd(output) }, promptTokens(): number | null }`. Each strategy
   creates one per `run()`:
   - ReAct: append `recorder.handler` to the existing `callbacks` array of `agent.stream`.
   - Plan-and-Execute: default `planner`/`replanner` call `structuredModel.invoke(msgs, { callbacks: [recorder.handler] })`.
   - Reflection: default critic adds `recorder.handler` beside its existing
     `handleChatModelStart`; final `promptTokens = sumPromptTokens([...baseRuns.map(r => r.metrics.promptTokens ?? null), ...criticUsages])`.
   Injected fakes produce no events → `null`.
2. **Breakdown** (R5): `composeChatContext` renders sections once; `prompt` equals today's
   output byte-for-byte (existing tests protect this). Controller calls
   `estimateContextBreakdown(context.sections)` before running the strategy.
3. **Response** (contracts/chat-metrics.md): `promptTokens: result.metrics.promptTokens ?? null`.
4. **Script** (contracts/conversa-longa-cli.md, R6): `set -euo pipefail`, `curl --fail-with-body`,
   JSON in/out through `node -e`.

## Complexity Tracking

No constitution violations to justify.
