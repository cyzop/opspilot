# Contract: Ops store and tool boundary

## Store contract

The store implementation must satisfy the interface defined in `src/store/ops-store.ts`:

```ts
interface OpsStore {
  listServices(): ServiceRecord[];
  listAlerts(status?: AlertFilter): AlertRecord[];
  listIncidents(status?: IncidentFilter): IncidentRecord[];
  openIncident(input: OpenIncidentInput): IncidentRecord;
  resolveIncident(id: string): IncidentRecord;
  getRunbook(service: string): RunbookRecord;
}
```

### Domain contracts

```ts
const severitySchema = z.enum(["critical", "high", "medium", "low"]);
const alertStatusSchema = z.enum(["firing", "resolved"]);
const incidentStatusSchema = z.enum(["open", "resolved"]);
const alertFilterSchema = z.enum(["firing", "resolved", "all"]);
const incidentFilterSchema = z.enum(["open", "resolved", "all"]);
```

## Tool contracts

### `list_incidentes`

```json
{
  "status": "open | resolved | all",
  "default": "open"
}
```

Behavior:

- returns open incidents by default
- supports explicit `resolved` and `all` filters
- validates input before query execution
- returns the incident records in a stable order

### `consultar_runbook`

```json
{
  "service": "string",
  "description": "Operational service key used to fetch the matching runbook, such as checkout, payments, or auth"
}
```

Behavior:

- accepts a service key with a seeded runbook (`checkout`, `payments`, or `auth`)
- returns the runbook guidance for that service
- rejects unknown runbook keys or empty values
- keeps the output schema aligned with the domain runbook object

## Chosen persistence boundary

The production implementation runs through `SqliteOpsStore`, while the existing in-memory implementation remains available for benchmarks and deterministic offline tests. All tool and service access flows continue to go through the `OpsStore` interface rather than bypassing it. `list_incidentes` defaults to `open`; the store-level `listIncidents()` default remains `all` for compatibility with existing callers.
