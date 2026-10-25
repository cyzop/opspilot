---

description: "Task list for the OpsPilot MCP server feature"
---

# Tasks: OpsPilot MCP Server

**Input**: Design documents from `specs/006-opspilot-mcp-server/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/opspilot-mcp.md](./contracts/opspilot-mcp.md)

**Tests**: Integration tests are included because the specification explicitly requires exercising the server over stdio and verifying tool discovery.

**Organization**: Tasks are grouped by user story so discovery/invocation and protocol/runtime guarantees can be implemented and verified in increments.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel with another task because it touches different files and has no incomplete-task dependency.
- **[Story]**: User story served by the task.
- Every task description names its target file or files.

## Phase 1: Setup

**Purpose**: Add the MCP SDK dependency and runnable project command.

- [X] T001 Add `@modelcontextprotocol/sdk` stable v1 dependency and the `mcp` script for `tsx src/mcp/server.ts` in `package.json` and update `package-lock.json`; include `--env-file-if-exists=.env` before `--import tsx` only if the server runtime needs `.env`.

---

## Phase 2: Foundational

**Purpose**: Shared prerequisites required before the MCP user stories.

No additional foundational task is needed: the existing OpsStore, tool factories, schemas, test runner, and TypeScript configuration provide the required foundation.

---

## Phase 3: User Story 1 - Discover and use OpsPilot operations through MCP (Priority: P1) 🎯 MVP

**Goal**: Start the `opspilot` stdio server, discover exactly three public tools, and invoke them over one shared store using existing operation logic and schemas.

**Independent Test**: Launch the server as a child process with `OPSPILOT_DB=:memory:` through the SDK stdio client; verify server identity and the exact tool names `list_alerts`, `open_incident`, and `resolve_incident`; invoke `list_alerts` and open/resolve an incident, confirming the mutation is visible.

### Tests for User Story 1

- [X] T002 [US1] Add an SDK stdio integration test that spawns `src/mcp/server.ts` via `node --import tsx`, sets `OPSPILOT_DB=:memory:`, initializes the client, and asserts the server identity and exact three public tool names in `tests/mcp/server.test.ts`.
- [X] T003 [US1] Extend the stdio integration test to invoke `list_alerts` with `status` in `firing | resolved | all` and default `firing`, invoke `open_incident` with required `title`, `service`, and `severity` fields, then invoke `resolve_incident` with required `id` and assert returned alert/incident data and resolved state in `tests/mcp/server.test.ts`.

### Implementation for User Story 1

- [X] T004 [US1] Implement MCP registration in `src/mcp/server.ts` using `McpServer` and `StdioServerTransport`; build selected tools once with `createOpsTools(store)`, register only `listAlerts`, `openIncident`, and `resolveIncident`, derive each MCP input schema from the existing tool Zod schema shape, delegate handlers to the existing tool `invoke`, and expose public `open_incident` for internal `open_incidente` while preserving `list_alerts` values `firing | resolved | all` and default `firing`.
- [X] T005 [US1] Compose one production `SqliteOpsStore` for the server lifetime, identify the MCP server as `opspilot`, connect the stdio transport, close the store on shutdown, and add no application writes to stdout in `src/mcp/server.ts`.

**Checkpoint**: The real process supports discovery and calls for all three public tools, and incident changes persist across calls in the same in-memory store.

---

## Phase 4: User Story 2 - Preserve the MCP protocol stream and existing operational behavior (Priority: P2)

**Goal**: Keep stdout protocol-clean, report diagnostics on stderr, and preserve existing Zod/domain error behavior without duplicated schemas or fabricated success.

**Independent Test**: Run the server through the stdio client while invoking invalid input and a domain failure; confirm each is reported as an MCP tool error, subsequent calls still work, and the client completes discovery without non-protocol stdout output.

### Tests for User Story 2

- [X] T006 [US2] Extend `tests/mcp/server.test.ts` to verify invalid tool arguments and unknown incident errors are returned as MCP errors without success-shaped content, the server remains usable for a subsequent valid request, and stdout contains no non-protocol startup or diagnostic text.

### Implementation for User Story 2

- [X] T007 [US2] Map existing tool invocation failures to MCP `isError` text responses while preserving error details, route startup/runtime diagnostics only to stderr, and ensure no `console.log` or other application stdout writes exist in `src/mcp/server.ts`.

**Checkpoint**: Validation and domain failures remain visible to the MCP client, do not corrupt stdio framing, and do not prevent later valid tool calls.

---

## Phase 5: Polish & Cross-Cutting Validation

**Purpose**: Verify all feature behavior and document the runnable command.

- [X] T008 Update `specs/006-opspilot-mcp-server/quickstart.md` to document the implemented `npm run mcp` command, any required environment setup, and the stdio integration validation procedure.
- [X] T009 Run `npm test` and `npm run typecheck` from `package.json`, confirming all MCP integration and existing tests pass.

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 establishes the SDK dependency and launch command.
- **Foundational (Phase 2)**: No tasks; the existing project infrastructure is sufficient after T001.
- **User Stories (Phase 3+)**: US1 begins after T001 and delivers the independently testable MCP server. US2 builds on the server and tests its error/protocol behavior.
- **Polish (Phase 5)**: Depends on US1 and US2 implementation.

### User Story Dependencies

- **User Story 1 (P1)**: Depends on the setup task only; it delivers the MCP MVP.
- **User Story 2 (P2)**: Depends on US1's server registration and process composition.

### Within Each User Story

- Tests MUST be added before their corresponding implementation and should fail until the feature exists.
- In US1, perform the registration (`T004`) before process composition (`T005`).
- Complete US1 before adding US2 failure/protocol tests and handling.
- Finish with project-wide tests and typecheck.

### Parallel Opportunities

- No implementation tasks are marked parallel because test and source work converge on the same MCP server boundary, while package setup must precede the tests.
- After the implementation, the quickstart review (`T008`) can be done independently of the final validation command (`T009`).

## Parallel Example: User Story 1

```text
Sequential TDD flow:
  T002 - Add discovery test in tests/mcp/server.test.ts
  T003 - Extend the same test file for list/open/resolve calls
  T004 - Register MCP tools and delegate to existing tool instances in src/mcp/server.ts
  T005 - Compose the stdio process and shared SQLite store in src/mcp/server.ts
```

## Implementation Strategy

1. Add the SDK dependency and npm command.
2. Deliver the P1 MVP with exact tool discovery and end-to-end alert/incident operations on one store.
3. Add P2 error mapping and stdout/stderr guarantees.
4. Review quickstart instructions and run the complete test and typecheck gates.
