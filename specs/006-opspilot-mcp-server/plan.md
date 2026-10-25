# Implementation Plan: OpsPilot MCP Server

**Branch**: `006-opspilot-mcp-server` | **Date**: 2026-10-11 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/006-opspilot-mcp-server/spec.md`

## Summary

Expose `list_alerts`, `open_incident`, and `resolve_incident` through an OpsPilot MCP server named `opspilot` over stdio. Compose the existing tool factories once over one `OpsStore`, derive MCP input schemas from those tools' existing Zod schemas, and delegate calls to their existing handlers. The public MCP name `open_incident` maps to the existing internal `open_incidente` tool. Keep stdout exclusively for protocol traffic, write diagnostics to stderr, and validate discovery and operations through a spawned stdio client/server integration test using an in-memory SQLite store.

## Technical Context

**Language/Version**: TypeScript ESM, Node.js 22 LTS, `strict: true`.

**Primary Dependencies**: `@modelcontextprotocol/sdk` v1.x stable API, existing Zod v4 schemas, `tsx`, and the project's `SqliteOpsStore`.

**Storage**: Existing SQLite `OpsStore`; production path follows `OPSPILOT_DB` (default `./data/opspilot.db`), integration tests set `OPSPILOT_DB=:memory:`.

**Testing**: `node:test` via `tsx`; integration coverage spawns the server over stdio using the MCP SDK client transport, without external services or persistent data.

**Target Platform**: Node.js 22.9+ local process integrations using stdin/stdout.

**Project Type**: TypeScript ESM application with existing shared operational tools and an MCP process entry point.

**Performance Goals**: Complete MCP initialization and tool discovery without additional network calls; tool invocations retain existing OpsStore operation costs.

**Constraints**: Exactly the three specified public tools; stdio stdout is reserved for MCP protocol frames; diagnostics use stderr only; use one `OpsStore` and existing Zod schemas/handlers; adapt only the `open_incidente` to `open_incident` public name; no duplicate validation schemas; preserve default `list_alerts` status `firing`; add the `mcp` npm command.

**Scale/Scope**: One local MCP server process, three tools, one shared store, one process-level integration test suite; no HTTP transport, authentication, additional tools, or new persistence model.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle / gate | Status | Evidence |
|---|---|---|
| MVC and controlled effects | PASS | MCP is a boundary adapter over the existing tool and service layers; it adds no domain logic. |
| Zod boundary validation | PASS | MCP schemas are derived from existing tool Zod schemas and calls delegate to their existing validated handlers. |
| Explicit domain errors | PASS | Existing operation errors remain explicit MCP tool errors; no success-shaped fallback is introduced. |
| Tests and quality | PASS | The real stdio process is exercised with the MCP client and an isolated SQLite store; `npm test` and `npm run typecheck` remain required. |
| Security and Spec Kit | PASS | No credentials or arbitrary network destinations are introduced; the feature follows specify → plan → tasks → implement. |
| Stack and persistence | PASS | Uses Node 22 ESM/TypeScript, Zod, and the existing SQLite-backed `OpsStore`. |
| Stdio protocol integrity | PASS | The server emits no application output on stdout; diagnostics, if needed, go to stderr. |

No constitution violations are identified.

## Phase 0: Research

See [research.md](./research.md). The SDK v1.x stable API supports `McpServer`, `StdioServerTransport`, Zod-backed tool input schemas, and a stdio client transport suitable for launching a child process in integration tests. Repository inspection confirmed that existing tools expose their Zod schemas and encapsulate operation/output validation, enabling MCP registration to reuse them instead of reimplementing business behavior.

## Phase 1: Design & Contracts

See [data-model.md](./data-model.md), [contracts/opspilot-mcp.md](./contracts/opspilot-mcp.md), and [quickstart.md](./quickstart.md). Design composes existing OpsPilot tools on one store, registers only the three public tool names, adapts the one legacy name, and routes diagnostics to stderr.

## Project Structure

### Documentation (this feature)

```text
specs/006-opspilot-mcp-server/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── opspilot-mcp.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
src/
└── mcp/
    └── server.ts

tests/
└── mcp/
    └── server.test.ts

package.json
```

**Structure Decision**: Add one server entry point under `src/mcp/`, compose the shared tools through `src/tools/index.ts`, and run process-level stdio integration tests under `tests/mcp/`. Add the official MCP SDK as a production dependency and the `mcp` script to `package.json`; do not create parallel domain/store/tool logic.

## Complexity Tracking

No constitution gate exceptions or additional architecture layers are required.

## Post-Design Constitution Check

PASS. The MCP server remains a protocol adapter over existing validated operations and the SQLite store. Its subprocess test uses `:memory:`, and application diagnostics cannot contaminate protocol output.
