# Quickstart: OpsPilot MCP Server

## Prerequisites

- Node.js 22.9 or newer
- Project dependencies installed

## Start the server

```powershell
npm run mcp
```

The command starts an MCP server named `opspilot` over stdio. Connect an MCP host using its process/stdio configuration. Do not expect a human-readable startup banner on stdout; it is reserved for MCP protocol traffic. Diagnostics, when present, go to stderr.

## Run validation

```powershell
npm test
npm run typecheck
```

The integration test spawns the real server with `OPSPILOT_DB=:memory:` and an SDK stdio client. It verifies server identity and the exact public tool catalog, then exercises alert listing and incident state changes without external services or persistent operational data.

For tool input mappings and return behavior, see [contracts/opspilot-mcp.md](./contracts/opspilot-mcp.md). The shared store and tool entities are described in [data-model.md](./data-model.md).
