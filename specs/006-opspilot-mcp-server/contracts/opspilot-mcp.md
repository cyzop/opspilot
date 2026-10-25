# Contract: OpsPilot MCP Server

## Server identity and transport

- Name: `opspilot`
- Transport: stdio
- The process stdout is reserved for MCP protocol frames. Application diagnostics are written to stderr.
- Launch command: `npm run mcp`

## Public tool catalog

The server advertises exactly these tool names:

| Public name | Existing OpsPilot tool | Input schema source |
|---|---|---|
| `list_alerts` | `listAlerts` (`list_alerts`) | Existing list-alerts Zod schema |
| `list_incidentes` | `listIncidentes` (`list_incidentes`) | Existing list-incidents Zod schema |
| `open_incident` | `openIncident` (`open_incidente`) | Existing open-incident Zod schema |
| `resolve_incident` | `resolveIncident` (`resolve_incident`) | Existing resolve-incident Zod schema |

The MCP-facing input schemas are the selected existing tools' Zod object schemas, passed whole (not as a raw shape) so their `.strict()` rejection of unknown fields is preserved. Tool descriptions, validation, operation behavior, result validation, and JSON serialization are delegated to the existing tools. No MCP-specific duplicate domain/input schema is permitted.

## Inputs

- `list_alerts`: optional `status` of `firing`, `resolved`, or `all`; omitted status uses `firing`.
- `list_incidentes`: optional `status` of `open`, `resolved`, or `all`; omitted status uses `open`.
- `open_incident`: existing `title`, `service`, and `severity` fields and validation.
- `resolve_incident`: existing `id` field and validation.
- Unknown fields are rejected as invalid arguments for every tool.

## Results and failures

- Successful calls return the existing tool's validated serialized result as MCP text content.
- Invalid arguments and domain failures are represented as MCP tool errors; they must not be converted into success-shaped results.
- The tools share the single `OpsStore` passed to the existing tool factory, so mutations are visible to later calls in the same server process.

## Runtime and test isolation

- The `mcp` npm script starts `src/mcp/server.ts`.
- The default store uses existing `OPSPILOT_DB` configuration.
- Process-level integration tests start with `OPSPILOT_DB=:memory:` and use the SDK stdio client transport.
