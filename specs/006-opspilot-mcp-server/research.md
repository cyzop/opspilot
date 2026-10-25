# Research: OpsPilot MCP Server

## Decision: use the stable v1.x TypeScript MCP SDK API with stdio transport

Implement the process entry point with `McpServer` and `StdioServerTransport` from `@modelcontextprotocol/sdk`. Add only the official SDK dependency; Zod is already present. Use the stable v1 API (resolved and validated at version `1.32.1`) rather than adopting the v2 alpha API.

### Rationale

- The feature is a local child-process integration, for which stdio is the SDK-supported transport.
- The SDK's high-level server API registers tools from Zod schemas and returns MCP content blocks.
- The stable v1 API has current examples for server registration and stdio client/server interoperability.

### Alternatives considered

- Streamable HTTP: rejected because the requested integration is stdio and does not need a listening network service.
- v2 alpha SDK: rejected because the project needs a stable API and has no requirement for alpha-only functionality.
- Hand-written JSON-RPC framing: rejected because it would duplicate protocol behavior and increase compatibility risk.

## Decision: derive MCP tools from the existing OpsPilot tool instances

Construct `createOpsTools(store)` once and select the existing `listAlerts`, `openIncident`, and `resolveIncident` tool objects. Pass each tool's existing Zod object shape as the MCP input schema and delegate each MCP handler to that tool's `invoke` method. Register the public name `open_incident` while delegating to the `open_incidente` tool. Do not register the other existing OpsPilot tools.

### Rationale

- The existing tool objects already own input validation, domain operation delegation, output schema validation, descriptions, and serialization.
- Deriving MCP JSON Schema from the tool's existing Zod schema avoids a second independent schema definition.
- Delegating through the tool also ensures the MCP server and other OpsPilot surfaces share operation behavior and use one `OpsStore`.
- The internal/public name adapter addresses the existing `open_incidente` versus requested `open_incident` naming difference without changing the existing registry contract.

### Alternatives considered

- Reimplement operations directly against the store: rejected because it would duplicate tool logic and boundary validation.
- Declare a second set of MCP Zod schemas: rejected because it creates two sources of truth.
- Expose all entries from `opsTools`: rejected because the feature scope specifies exactly three public tools.

## Decision: keep stdout exclusively for MCP frames and use stderr for diagnostics

The entry point emits no normal startup logging. If startup or runtime errors must be reported outside the MCP protocol, write them to stderr; do not use `console.log` or other application writes to stdout. Tool results are returned only through MCP response content.

### Rationale

- Stdio framing uses process stdout as protocol output, so unrelated messages can corrupt the stream.
- A silent successful startup needs no human-readable stdout banner.
- Error output on stderr remains visible to operators without being interpreted as protocol data.

### Alternatives considered

- Log startup messages to stdout: rejected because it violates stdio protocol framing.
- Suppress all failures: rejected because it hides operational errors.
- Add a file logger: rejected because it introduces storage/configuration outside feature scope.

## Decision: test the executable boundary with isolated storage

Spawn the actual `src/mcp/server.ts` process with `node --import tsx`, set `OPSPILOT_DB=:memory:`, connect through the SDK `Client` and `StdioClientTransport`, then list and invoke tools. Verify the advertised names and that protocol discovery succeeds with no non-protocol stdout output. Close the client/child process in test cleanup.

### Rationale

- A real child process validates transport setup and protocol framing end to end.
- MCP client/server integration exercises the same public boundary used by MCP hosts.
- In-memory SQLite prevents persistent data changes and external service dependencies.

### Alternatives considered

- Test only a local registration factory: rejected because it would not verify process transport or stdout integrity.
- Contact live operational services: rejected because no external service is needed and it would make tests nondeterministic.

## Sources

- Model Context Protocol TypeScript SDK server documentation: <https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.29.0/docs/server.md>
- Model Context Protocol TypeScript SDK client documentation: <https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.29.0/docs/client.md>
- Model Context Protocol TypeScript SDK protocol documentation: <https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.29.0/docs/protocol.md>
- Installed `@modelcontextprotocol/sdk` version verified by `npm ls`: `1.32.1`.
