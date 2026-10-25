# Implementation Plan: SQLite Ops Persistence

**Branch**: `004-sqlite-ops-store` | **Date**: 2026-10-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/004-sqlite-ops-store/spec.md`

## Summary

Replace the current in-memory-only persistence boundary with a real SQLite-backed `OpsStore` implementation while preserving the existing contract and keeping deterministic in-memory behavior available for tests and benchmarks. The new store will model services, alerts, incidents, and runbooks, enforce enum constraints at the database boundary, initialize its schema idempotently, and seed the Mercadinho scenario without duplicating records. The tool layer will add explicit `list_incidentes` and `consultar_runbook` actions and tighten the descriptions for the open-incident workflow and enumerated fields.

## Technical Context

**Language/Version**: TypeScript ESM, Node.js 22 LTS, `strict: true`.

**Primary Dependencies**: `node:sqlite` for native SQLite persistence, Zod for validation, the current domain schema in `src/domain/domain.ts`, and the existing LangChain tool API in `src/tools/*`.

**Storage**: SQLite using `DatabaseSync` with `OPSPILOT_DB` path resolution and `:memory:` fallback for tests.

**Testing**: `node:test` via `tsx`; targeted `:memory:` tests for store initialization, seeded data, incident filters, and constraint enforcement.

**Target Platform**: Local Node.js application runtime with a writable `data/` directory in production and isolated in-memory tests in CI or local development.

**Project Type**: TypeScript ESM service with a domain/store boundary and small tool layer over the Ops domain.

**Performance Goals**: Keep read/write operations linear and local while preserving fast deterministic startup and test execution.

**Constraints**: The store must implement the existing `OpsStore` interface exactly; all SQL must be prepared statements; invalid enum values must be rejected; no database files may be committed to Git; test runs must be isolated from each other.

**Scale/Scope**: The feature is limited to persistence, incident filtering, runbook retrieval, and tool description alignment. It does not introduce a new domain model or alter the broader OpsPilot reasoning flow.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle / gate | Status | Evidence |
|---|---|---|
| MVC and controlled effects | PASS | Persistence is kept behind the existing store boundary; domain logic remains separate from database I/O. |
| Zod boundary validation | PASS | The domain and tool contracts already validate inputs and the SQLite layer adds DB-side checks without bypassing the store contract. |
| Explicit domain errors | PASS | Unknown service and incident cases continue to raise domain errors; invalid values are rejected before persistence. |
| Tests and quality | PASS | The feature requires in-memory tests, schema checks, and green `npm test` and `npm run typecheck`. |
| Security and Spec Kit | PASS | No secrets or `.env` content are read directly; prepared statements and idempotent seeds protect the runtime boundary. |
| Required stack and flow | PASS | The project remains on Node.js 22 + TypeScript + Zod and follows the Spec Kit flow for the feature. |

No constitution violations are identified.

## Phase 0: Research

See [research.md](./research.md). The research resolves the SQLite adoption, schema and seed strategy, prepared statement requirement, tool additions, and the separation between the production SQLite store and the in-memory mock used in tests and benchmarks.

## Phase 1: Design & Contracts

See [data-model.md](./data-model.md), [contracts/ops-tools.md](./contracts/ops-tools.md), and [quickstart.md](./quickstart.md). The design adds a concrete SQLite store contract, explicit entity definitions for alerts, incidents, and runbooks, and a validation guide that exercises the Mercadinho seed, incident lifecycle, and tool behavior.

## Project Structure

### Documentation (this feature)

```text
specs/004-sqlite-ops-store/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── ops-tools.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
src/
├── domain/
│   ├── domain.ts
│   ├── ops-service.ts
│   └── errors.ts
├── store/
│   ├── ops-store.ts
│   ├── ops-database.ts
│   └── sqlite-ops-store.ts
├── tools/
│   ├── index.ts
│   ├── list-alerts.ts
│   ├── open-incident.ts
│   ├── resolve-incident.ts
│   ├── list-incidentes.ts
│   └── consultar-runbook.ts
├── bench.ts
├── arena.ts
└── index.ts

tests/
├── store/
│   └── sqlite-ops-store.test.ts
├── tools/
│   ├── consultar-runbook.test.ts
│   ├── list-incidentes.test.ts
│   ├── list-alerts.test.ts
│   ├── open-incident.test.ts
│   ├── resolve-incident.test.ts
│   └── index.test.ts
```

**Structure Decision**: Keep the repository as a single TypeScript ESM project and place persistence under `src/store/`, keeping the domain and tools layered above it. This preserves the current architecture, allows a replacement of the in-memory implementation without changing the calling code, and keeps benchmark and test scenarios reproducible through the mock implementation.

## Complexity Tracking

No constitution gate exceptions required. The feature stays within the existing model/service/store/tool boundaries and uses a focused persistence adapter plus a small tool description update.

## Post-Design Constitution Check

PASS. The design keeps the domain model clean, moves persistence behind the store interface, requires DB validation and prepared statements, and preserves the existing in-memory behavior for tests and benchmarks. The feature remains safe, bounded, and aligned with the project’s stack and Spec Kit workflow.
