# Implementation Plan: OpsPilot Reasoning Core

**Branch**: `001-reasoning-core` | **Date**: 2026-10-03 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-reasoning-core/spec.md`

## Summary

Build a bounded, comparable reasoning core with a shared strategy-result contract,
an OpenRouter-backed model factory, Zod-validated incident tools over isolated
in-memory stores loaded from a JSON baseline, ReAct and Plan-and-Execute
strategies, and a CLI arena. Sequelize/MySQL models remain available for a later
persistence adapter.
Deterministic store and trace tests will use the in-memory adapter and will not
make model or database network calls.

## Technical Context

**Language/Version**: TypeScript 7, ESM, Node.js 22 LTS (project engine `>=22.9.0`).

**Primary Dependencies**: `@langchain/core` 1.2.14, `@langchain/openai` 1.6.2,
`@langchain/langgraph` 1.4.18, Zod 4.6.5, Sequelize 6.37.8, `mysql2` 3.24.5,
and `tsx` 4.23.15; versions are resolved by the existing lockfile.

**Storage**: `data/ops-store.json` contains the current seed database. Each
strategy loads a validated, isolated in-memory copy; tool mutations are visible
within the run and do not write to disk. `npm run seed` idempotently restores the
five service/six alert baseline while preserving additional JSON records.
Sequelize/MySQL model definitions are retained but are not connected by the
current arena or seed command.

**Testing**: Node built-in test runner with `tsx`, using `npm test`; deterministic
unit tests cover the JSON seed, in-memory store, trace formatting, and strategy
limits via injected model/tool fakes. `npm run typecheck` is required. Live
OpenRouter checks are manual integration scenarios, not unit tests.

**Target Platform**: Node.js 22 LTS on Windows and other supported Node platforms.

**Project Type**: TypeScript ESM CLI/application with internal agent and storage
modules.

**Performance Goals**: No fixed throughput SLA for this local prototype. Every
strategy run returns elapsed time in milliseconds and its complete bounded trace.

**Constraints**: OpenRouter key/model are required only when a model-backed
strategy is invoked. ReAct model iterations are capped by `maxIterations`;
`maxIterations` is the maximum number of LLM invocations per strategy run,
including planner and replanner calls. Plan-and-Execute stores completed step /
tool-result pairs, replans with an explicit adjust/continue/finish decision, and
executes at most eight actions. Arena and deterministic tests use isolated
in-memory copies of the validated JSON baseline.

**Scale/Scope**: One local arena run, one or more selected strategies, five
seeded services, six seeded alerts (three firing and three resolved), and a
maximum of eight Plan-and-Execute actions. Authentication, deployment, and
production monitoring integrations are out of scope.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle / gate | Status | Evidence |
|---|---|---|
| MVC and controlled effects | PASS | Store/domain behavior stays behind a store port; model, database, CLI, and agent calls remain at adapters/boundaries. |
| Zod boundary validation | PASS | Validate tool inputs and results, arena flags, planner/replanner structured output, and strategy results with Zod schemas. |
| Explicit domain errors | PASS | Unknown services/incidents and configuration/tool errors propagate as typed errors and are translated by the CLI/tool boundary. |
| Tests and quality | PASS | Pure store/trace tests use `node:test` and no network; tasks will require `npm test` and `npm run typecheck`. |
| Security and Spec Kit | PASS | Never print secrets; use Node native optional env-file loading. This design follows the active feature spec and is small enough to review by module. |
| Required stack/flow | PASS | Uses Node 22 ESM, strict TypeScript, LangChain/LangGraph, OpenRouter, Zod, Express-compatible MySQL via Sequelize/mysql2, and the specified Spec Kit sequence. |

No constitution violations are identified.

## Phase 0: Research

See [research.md](./research.md). It records the verified framework API choices,
iteration/call-count policy, JSON baseline, and in-memory isolation behavior.
Sequelize/MySQL models remain separate from the active mock-tool execution path.

## Phase 1: Design & Contracts

See [data-model.md](./data-model.md), [contracts/](./contracts/), and
[quickstart.md](./quickstart.md). The JSON baseline feeds isolated in-memory tool adapters. Sequelize remains a
separate, unused persistence adapter until a future request enables MySQL.

## Project Structure

### Documentation (this feature)

```text
specs/001-reasoning-core/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
└── contracts/
    ├── reasoning-strategy.md
    ├── agent-tools.md
    └── arena-cli.md
```

### Source Code (repository root)

```text
src/
├── llm/
│   └── model.ts
├── trace/
│   └── trace.ts
├── domain/
│   └── ops-service.ts
├── store/
│   ├── ops-database.ts
│   ├── seed-data.ts
│   └── ops-store.ts
├── strategies/
│   ├── strategy.ts
│   ├── react.ts
│   └── plan-and-execute.ts
├── tools/
│   ├── list-alerts.ts
│   ├── open-incident.ts
│   ├── resolve-incident.ts
│   └── index.ts
├── db/
│   ├── json-seed.ts
│   ├── sequelize.ts
│   └── models.ts
└── arena.ts

tests/
├── trace/
│   └── trace.test.ts
├── store/
│   └── ops-store.test.ts
├── strategies/
│   ├── react.test.ts
│   └── plan-and-execute.test.ts
├── tools/
│   ├── list-alerts.test.ts
│   ├── open-incident.test.ts
│   ├── resolve-incident.test.ts
│   └── index.test.ts
└── db/
    └── json-seed.test.ts

data/
└── ops-store.json

scripts/
└── seed.ts

Configuration:
.env.example # OpenRouter values; JSON seed does not require database variables
```

**Structure Decision**: Use the existing single TypeScript ESM project. Agent,
domain service/store, trace formatting, JSON seed, Sequelize model definitions,
and arena are kept in distinct modules. The tool module is the agent boundary
and delegates domain operations to the service/store, preserving MVC-style
separation without adding an unused HTTP controller. Tests live in
`tests/`, mirroring the `src/` folders, and `npm test` scans
`tests/**/*.test.ts`. The seed script validates
and writes the local JSON baseline without initializing MySQL.
Include `tests/**/*.ts` and `scripts/**/*.ts` in `tsconfig.json` so the tests
and the seed are typechecked.
Sequelize 6 provides its own TypeScript declarations; do not add
`@types/sequelize`.

## Complexity Tracking

No constitution gate exceptions or additional architectural projects are
required. The JSON baseline and isolated in-memory store serve current tool/test
execution; the Sequelize adapter remains available without requiring a server.

## Post-Design Constitution Check

PASS. Design keeps domain operations deterministic and pure at the in-memory
boundary; all external model/database work stays in adapters. Schemas guard
inputs and planner output, errors remain explicit, and network-free unit tests
are a first-class implementation task. The chosen file layout follows the
requested module names and existing ESM/TypeScript project.
