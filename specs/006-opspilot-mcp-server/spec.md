# Feature Specification: OpsPilot MCP Server

**Feature Branch**: `006-opspilot-mcp-server`

**Created**: 2026-10-11

**Status**: Draft

**Input**: User description: "MCP server do OpsPilot: `src/mcp/server.ts` com `@modelcontextprotocol/sdk`, transport stdio, expondo `list_alerts`, `open_incident` e `resolve_incident` - reutilizando o mesmo `OpsStore` e os mesmos schemas Zod das tools existentes (uma única fonte de verdade). Nome do server: `opspilot`. Script npm: `mcp = \"tsx src/mcp/server.ts\"` (se precisar de env, alterar o script e carregar elas antes). REGRA CRÍTICA: nenhum `console.log` no server - no stdio o stdout é o canal do protocolo; diagnóstico vai para o stderr. Test: sobre o server e valida o list de tools."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Discover and use OpsPilot operations through MCP (Priority: P1)

As an MCP client, I want to discover and invoke OpsPilot's alert and incident operations so that I can use the same operational capabilities available inside OpsPilot through a standard tool interface.

**Why this priority**: A discoverable and callable tool catalog is the core value of exposing OpsPilot as an MCP server.

**Independent Test**: Start the server with an isolated OpsStore through the stdio transport, issue an MCP tool-list request, and verify that exactly `list_alerts`, `list_incidentes`, `open_incident`, and `resolve_incident` are advertised with usable input schemas. Invoke operations through the MCP client and verify their results reflect the same store state.

**Acceptance Scenarios**:

1. **Given** an MCP client connects over stdio, **When** it requests the server information and available tools, **Then** it identifies the server as `opspilot` and receives the four supported tool names with their input schemas.
2. **Given** an MCP client invokes `list_alerts`, **When** no filter is supplied, **Then** the server returns the default firing alerts using the existing operation contract.
3. **Given** an MCP client invokes `open_incident` with valid input and then `resolve_incident` with the returned identifier, **When** both operations run on the same store, **Then** the response reflects the opened incident and its resolved state.
4. **Given** an MCP client supplies invalid tool input, **When** the tool call is processed, **Then** validation follows the existing Zod schemas and no invalid operation is applied.

---

### User Story 2 - Preserve the MCP protocol stream and existing operational behavior (Priority: P2)

As an operator launching the MCP server, I want protocol output kept separate from diagnostics and operations to reuse the existing store and validation contracts so that clients receive valid MCP messages without divergent operational behavior.

**Why this priority**: A single stray stdout message breaks stdio protocol framing, and duplicated schemas or stores could make MCP results disagree with OpsPilot.

**Independent Test**: Launch the server as a child process with stdio pipes, complete MCP initialization and tool discovery, and verify stdout contains only protocol messages while diagnostics, if any, are written to stderr. Confirm the server composition shares one OpsStore and the established input/output validation contracts.

**Acceptance Scenarios**:

1. **Given** the server starts and handles MCP requests over stdio, **When** startup or request diagnostics are emitted, **Then** no non-protocol text is written to stdout and diagnostics are sent only to stderr.
2. **Given** OpsPilot tools and the MCP server process an operation, **When** inputs and results cross their boundaries, **Then** both use the existing OpsStore and the same Zod schemas rather than parallel definitions.
3. **Given** the project is run through its MCP command, **When** the server starts, **Then** it uses the stdio transport and is named `opspilot`.

### Edge Cases

- The MCP client disconnects while the server is reading or writing stdio.
- A tool receives an invalid or incomplete argument object.
- A requested incident identifier or service is unknown and the existing operation reports a domain error.
- An operation succeeds and a subsequent operation must observe the mutation through the same OpsStore.
- Startup diagnostics or runtime errors occur while stdout is reserved for MCP framing.
- The legacy tool name for opening an incident differs from the MCP public name; clients see `open_incident` while execution reuses the existing `open_incidente` operation and schema.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide an MCP server named `opspilot`, implemented with the official `@modelcontextprotocol/sdk` in `src/mcp/server.ts`, that communicates with clients over stdio.
- **FR-002**: The MCP server MUST advertise the tools `list_alerts`, `open_incident`, and `resolve_incident` through its tool-list operation.
- **FR-003**: The MCP server MUST allow clients to invoke each advertised tool and receive the corresponding OpsPilot operation result.
- **FR-004**: The MCP server MUST use the same `OpsStore` instance for its tools so that mutations made by one tool are observable by subsequent tool calls.
- **FR-005**: The MCP-facing tools MUST use the existing Zod input and output schemas and operation logic as the single source of truth; the MCP boundary MUST NOT introduce divergent duplicate schemas.
- **FR-006**: The MCP public name `open_incident` MUST invoke the existing open-incident operation, whose current internal tool name is `open_incidente`, without changing the MCP public name or duplicating its validation contract.
- **FR-007**: The `list_alerts` MCP tool MUST preserve the existing status filter values (`firing`, `resolved`, `all`) and default to `firing` when omitted.
- **FR-008**: The project MUST provide the npm script `mcp` with the command `tsx src/mcp/server.ts`; if startup requires environment variables, the script MUST load them before launching the server.
- **FR-009**: The server MUST NOT write application logs or diagnostics to stdout; diagnostics MUST be written to stderr so stdout remains exclusively available for MCP stdio protocol traffic.
- **FR-010**: An integration test MUST exercise the server over stdio, perform tool discovery, and verify that the advertised tool list includes exactly the four specified public names.
- **FR-011**: Tests MUST be isolated from external services and persistent operational data.

### Key Entities

- **MCP client session**: A client connection that initializes the server, discovers available tools, and invokes operations through stdio.
- **MCP tool**: A public operation entry with a name, description, input schema, and result; the public `open_incident` entry maps to the existing internal operation.
- **OpsStore**: The shared operational data store used to read alerts and create or resolve incidents.
- **Tool result**: The validated result or explicit operation error returned to the client for a tool invocation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An MCP client can initialize and discover all four required tools in one successful tool-list request.
- **SC-002**: 100% of MCP tool invocations use the same validation contracts as their existing OpsPilot operations.
- **SC-003**: An incident created through MCP can be resolved through a subsequent MCP call using the returned identifier and shared store.
- **SC-004**: The stdio integration test completes initialization and tool discovery without contacting external services or using a persistent operational database.
- **SC-005**: The stdio protocol stream contains no application diagnostic text on stdout during server startup or tool discovery.

## Assumptions

- The MCP server exposes only the four operations `list_alerts`, `list_incidentes`, `open_incident`, and `resolve_incident` in this version; other existing OpsPilot tools remain out of scope.
- The public MCP tool name for opening an incident is `open_incident`; it is an adapter name for the existing `open_incidente` tool, and does not require renaming the existing registry entry.
- The MCP tool input and result representations follow the existing operation schemas and result behavior, adapted to the MCP protocol's required tool-call envelope.
- The default runtime store follows the project's existing production composition and environment configuration; integration tests provide isolated in-memory storage.
- The requested SDK, source entry path, and npm command are implementation constraints for this feature; `.env` is loaded before execution only if the existing runtime composition requires environment configuration.
