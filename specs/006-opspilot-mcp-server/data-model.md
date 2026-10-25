# Data Model: OpsPilot MCP Server

This feature adds no persisted entity. It maps existing operational tools and store operations to transient MCP sessions and tool-call results.

## MCP server

| Field | Type | Constraints | Notes |
|---|---|---|---|
| name | string | Fixed value `opspilot` | Advertised during MCP initialization. |
| transport | protocol transport | stdio | Uses stdin/stdout for protocol framing. |

## Public MCP tool

| Field | Type | Constraints | Notes |
|---|---|---|---|
| name | string | Exactly `list_alerts`, `list_incidentes`, `open_incident`, or `resolve_incident` | `open_incident` adapts the existing internal tool name `open_incidente`. |
| description | string | Reused from the selected existing OpsPilot tool | Keeps usage guidance in one place. |
| input schema | Zod-derived JSON Schema | Derived from the existing tool's strict Zod object schema | No parallel MCP validation schema is defined. |
| handler | operation result | Delegates to existing tool `invoke` | Retains existing validation, OpsService, and output serialization. |

## Shared OpsStore

The server constructs or receives one `OpsStore` for its lifetime and passes it to the existing tool factory. All selected tools therefore operate over the same services, alerts, and incident state. Production composition uses the existing SQLite implementation and `OPSPILOT_DB`; tests use `:memory:`.

## Tool inputs

- `list_alerts`: optional `status`, using the existing `firing | resolved | all` schema and default `firing`.
- `list_incidentes`: optional `status`, using the existing `open | resolved | all` schema and default `open`.
- `open_incident`: existing open-incident schema (`title`, `service`, `severity`), delegated to internal tool `open_incidente`.
- `resolve_incident`: existing resolution schema (`id`).

## Tool results

Existing tool handlers validate their domain output and serialize it as JSON text. The MCP adapter returns that text in the protocol's text content block. Existing operation validation and domain failures remain visible as MCP tool-call errors rather than fabricated success data.
