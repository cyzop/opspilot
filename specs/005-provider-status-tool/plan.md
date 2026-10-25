# Implementation Plan: External Provider Status Check

**Branch**: `005-provider-status-tool` | **Date**: 2026-10-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/005-provider-status-tool/spec.md`

## Summary

Add an advisory `check_provider_status` tool for GitHub and Cloudflare using their public Statuspage v2 endpoints. Keep provider selection constrained to a fixed allowlist, validate upstream status data, bound each fetch attempt to five seconds with one retry for transient transport/5xx failures, and return compact success or readable error observations rather than throwing. Integrate through the repository's existing `src/tools/` factory and test the fetch boundary with injected fakes.

## Technical Context

**Language/Version**: TypeScript ESM, Node.js 22 LTS, `strict: true`.

**Primary Dependencies**: Existing LangChain tool API, Zod, Node.js Fetch API, and `AbortSignal.timeout`.

**Storage**: None; provider status is transient and is not persisted.

**Testing**: `node:test` via `tsx`; deterministic tests inject a fake fetch and make no external network requests.

**Target Platform**: Node.js 22 runtime used by OpsPilot agent strategies.

**Project Type**: TypeScript ESM application with shared operational tools registered through `src/tools/index.ts`.

**Performance Goals**: Each outbound attempt is limited to five seconds; at most two attempts are made, bounding network wait to ten seconds before local parsing and formatting.

**Constraints**: Fixed GitHub/Cloudflare URL allowlist; no API keys; Zod validation for provider input and upstream output; one retry only for transport failure/timeouts and HTTP 5xx; terminal failures return readable tool strings and do not escape as exceptions; output remains one line.

**Scale/Scope**: One tool, two provider endpoints, and isolated tests. No changes to storage, chat HTTP contract, or operational incident lifecycle.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle / gate | Status | Evidence |
|---|---|---|
| MVC and controlled effects | PASS | Provider I/O is isolated in a tool-level adapter; the agent-facing tool remains the boundary. |
| Zod boundary validation | PASS | Provider input and untrusted upstream status envelope are validated before use. |
| Explicit domain errors | PASS | Final provider failures become explicit error observations as required; no healthy fallback is returned. |
| Tests and quality | PASS | Fetch injection enables offline deterministic tests; full tests and typecheck remain required. |
| Security and Spec Kit | PASS | URLs are fixed by provider enum; no secrets are used; the feature follows Spec Kit. |
| Required stack and flow | PASS | Uses Node 22 Fetch/AbortSignal, existing TypeScript/Zod/LangChain tool patterns, and test runner. |

No constitution violations are identified.

## Phase 0: Research

See [research.md](./research.md). Research confirms the public endpoint response envelope and records decisions for validation flexibility, static URL mapping, retry classification, test injection, and existing tool registration.

## Phase 1: Design & Contracts

See [data-model.md](./data-model.md), [contracts/provider-status-tool.md](./contracts/provider-status-tool.md), and [quickstart.md](./quickstart.md). The design defines a transient provider/status result contract and the validation scenarios without introducing persistent state.

## Project Structure

### Documentation (this feature)

```text
specs/005-provider-status-tool/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── provider-status-tool.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
src/
└── tools/
    ├── check-provider-status.ts
    └── index.ts

tests/
└── tools/
    └── check-provider-status.test.ts
```

**Structure Decision**: Add the implementation alongside existing operational tool factories in `src/tools/` and register it through `createOpsTools` in `src/tools/index.ts`. Although the request referred to `src/agents/tools.ts`, that file does not exist in this repository; both reasoning strategies consume the shared tool factory, so this preserves current architecture and reaches each strategy. Put network-free tests beside existing tool tests under `tests/tools/`.

## Complexity Tracking

No constitution gate exceptions or extra architectural layers are required.

## Post-Design Constitution Check

PASS. The provider integration is a small boundary adapter with fixed destinations, validated inputs and output, bounded retries, no persistence, and deterministic offline tests. Failures remain visible to the agent as error observations and cannot be mistaken for provider health.
