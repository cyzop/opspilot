# Implementation Plan: Context Budget Builder

**Branch**: `012-context-budget-builder` | **Date**: 2026-10-19 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/012-context-budget-builder/spec.md`

## Summary

Add `src/context/context-builder.ts`, a pure builder that assembles the user-side context
for every reasoning strategy (memories, summary, window, current message) and enforces a
per-section ceiling in chars/4 tokens: summary 200, window 1,200 (drop oldest whole
messages), memories 300 (drop lowest-score whole facts). The current message and each
strategy's internal system prompts are never touched (clarified Q1 → A). Ceilings come from
`CONTEXT_BUDGET_SUMMARY|WINDOW|MEMORY`, validated at server construction. The chat
controller, arena and bench route strategy input through the builder; chat responses add
`metrics.contextBudget` and the breakdown reflects the trimmed context. See
[research.md](./research.md).

## Technical Context

**Language/Version**: TypeScript ESM (`strict: true`) on Node.js 22 LTS

**Primary Dependencies**: Zod 4, Express 5; reuses `estimateTokens` (010) and history/summary from 011

**Storage**: N/A

**Testing**: `node:test` via `tsx`; pure unit tests for trimming; server tests with fake strategies

**Target Platform**: Local Node.js HTTP server + CLIs (arena, bench)

**Project Type**: Single-project web service

**Performance Goals**: O(n) over messages/facts per turn; no model calls

**Constraints**: Message and strategy system prompts untouchable; identical output when nothing exceeds its ceiling; invalid config blocks startup

**Scale/Scope**: 1 new module + tests; server/composer/arena/bench wiring

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment | Status |
|-----------|------------|--------|
| I. MVC e efeitos controlados | Builder and trimming are pure functions; env read only in `loadContextBudget` at the edge (server construction); controller just wires. | PASS |
| II. Contratos Zod | `contextBudgetSchema` for env, `contextBudgetReportSchema` in `chatResponseSchema`. | PASS |
| III. Erros explícitos | Invalid budgets throw `ConfigurationError` naming the variable; trimming is reported, never silent. | PASS |
| IV. Testes | Unit tests for every cut rule plus server integration; gates kept (pre-existing 009 failures noted). | PASS |
| V. Segurança / Spec Kit | No secrets; no `.env` reads by hand; clarification recorded in spec. | PASS |

Post-design re-check: all PASS.

## Project Structure

### Documentation (this feature)

```text
specs/012-context-budget-builder/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/context-budget.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── context/
│   ├── context-builder.ts       # NEW: budget schema/loader, buildContext, trim helpers, report schema
│   └── tokens.ts                # unchanged (estimateTokens, breakdown)
├── http/
│   ├── compose-chat-prompt.ts   # delegates to buildContext with UNLIMITED budget
│   └── server.ts                # contextBudget option/loader, buildContext, metrics.contextBudget
├── arena.ts                     # strategy input via buildContext
└── bench.ts                     # strategy input via buildContext

tests/
├── context/context-builder.test.ts  # NEW
└── http/server.test.ts              # budget metrics + trimming + reflection path
```

**Structure Decision**: Single project; the builder lives next to the token and history
modules in `src/context/`, where the user asked for it.

## Complexity Tracking

No constitution violations to justify.

## Revision (implementation)

The user supplied a reference sketch at /speckit-implement and chose: shared `SYSTEM_PROMPT` section (cut `never`), summary cut `never`, order system → summary → history → memories → message. Budget keys/env follow the sketch: `CONTEXT_BUDGET_SYSTEM` (400), `CONTEXT_BUDGET_SUMMARY` (200), `CONTEXT_BUDGET_HISTORY` (1200), `CONTEXT_BUDGET_MEMORIES` (300). R1 (no shared system), the summary truncation in R3 and FR-011 identity are superseded; see the updated data-model.md and contracts/context-budget.md. The builder stays pure (caller fetches data) per constitution I.
