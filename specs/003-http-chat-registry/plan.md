# Implementation Plan: OpsPilot HTTP Chat Registry

**Branch**: `003-http-chat-registry` | **Date**: 2026-10-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/003-http-chat-registry/spec.md`

## Summary

Add an HTTP entry point for OpsPilot that accepts an operator message and resolves a strategy name through a central registry. The default request path uses the `react` strategy, while an explicit `reflect` flag wraps the selected strategy with the existing reflection decorator. The endpoint validates the request body with Zod, returns the standard answer/trace/metric contract on success, and translates invalid input, unknown strategies, and request timeout conditions into clear HTTP errors.

## Technical Context

**Language/Version**: TypeScript ESM, Node.js 22 LTS, `strict: true`.

**Primary Dependencies**: Express, Zod, the existing reasoning strategies and reflection decorator in `src/strategies`, and the current Node-based test runner via `tsx`.

**Storage**: No new persistence required; strategy resolution and runtime execution remain in-memory and request-scoped.

**Testing**: Deterministic `node:test` coverage with fake strategy instances and no live OpenRouter calls.

**Target Platform**: Node.js 22 LTS server runtime for local and deployment environments.

**Project Type**: TypeScript ESM web-service CLI/application with a thin HTTP boundary over the existing reasoning engine.

**Performance Goals**: Handle a single chat request within the configured 180s budget while preserving the existing reasoning trace and metrics contract.

**Constraints**: Validate request bodies at the HTTP boundary; reject invalid values with Zod issues; return `422` on unsupported strategy names; return `504` on timeout; maintain default strategy semantics and reflected strategy opt-in behavior.

**Scale/Scope**: One HTTP endpoint plus a centralized strategy registry; the feature does not redesign the strategy engine or alter the underlying answer/result contract.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle / gate | Status | Evidence |
|---|---|---|
| MVC and controlled effects | PASS | HTTP request validation and execution orchestration are separated from the strategy domain logic. |
| Zod boundary validation | PASS | Request schema and strategy selection contract are validated at the HTTP boundary. |
| Explicit domain errors | PASS | Invalid payloads, unknown strategies, and timeouts map to explicit HTTP error states rather than silent fallbacks. |
| Tests and quality | PASS | Deterministic fake-based integration tests and typecheck remain required. |
| Security and Spec Kit | PASS | No `.env` content or secrets are read manually; the feature follows the Spec Kit flow and keeps runtime behavior bounded. |
| Required stack and flow | PASS | The project remains on the established Node/TypeScript/Zod/Express stack and the spec-plan sequence is followed. |

No constitution violations are identified.

## Phase 0: Research

See [research.md](./research.md). The research resolves the default strategy behavior, route contract, timeout strategy, strategy registry structure, and the separation between HTTP validation and strategy execution.

## Phase 1: Design & Contracts

See [data-model.md](./data-model.md), [contracts/](./contracts/), and [quickstart.md](./quickstart.md). The design adds a thin HTTP service contract, a strategy registry model, and end-to-end validation scenarios for valid requests, invalid bodies, unsupported strategies, and timeout handling.

## Project Structure

### Documentation (this feature)

```text
specs/003-http-chat-registry/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── chat-http.md
└── tasks.md
```

### Source Code (repository root)

```text
src/
├── http/
│   └── server.ts
├── agentes/
│   └── index.ts
├── strategies/
│   └── reflection.ts
├── index.ts
└── arena.ts

tests/
├── http/
│   └── server.test.ts
├── agents/
│   └── registry.test.ts
└── strategies/
    └── reflection.test.ts
```

**Structure Decision**: Keep the project as a single TypeScript ESM application while introducing the new HTTP boundary and registry modules. The feature does not split the project into multiple packages; it instead adds the minimal new directories needed to isolate request validation, registry resolution, and integration testing.

## Complexity Tracking

No constitution gate exceptions or additional architectural projects are required.

## Post-Design Constitution Check

PASS. The HTTP boundary enforces request validation and error mapping, the registry remains a small deterministic adapter, and the strategy system stays unchanged except for opt-in reflection. The feature is bounded, testable, and does not bypass the existing domain contracts or security rules.
