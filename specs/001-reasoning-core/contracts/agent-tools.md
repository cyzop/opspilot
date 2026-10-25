# Contract: Agent Tools

All tool inputs and results are validated with Zod. The in-memory `OpsStore`
loads its initial records from `data/ops-store.json`; tool mutations are
isolated to that store instance. Tool results are serializable records or
explicit errors.

## `list_alerts`

- Input: `{ status?: "firing" | "resolved" | "all" }`.
- Default status: `firing`.
- Output: matching alerts, deterministically ordered by stable identifier.
- Empty match: empty list.
- Validate the returned list against the alert output schema.

## `open_incidente`

- Input: `{ title: string, service: string, severity: "critical" | "high" | "medium" | "low" }`.
- `title` must be non-empty; `service` must identify a seeded/known service.
- Output: newly created open incident.
- Unknown service: explicit domain error.
- Validate the returned incident against the incident output schema.

## `resolve_incident`

- Input: `{ id: string }`, non-empty.
- Output: incident with resolved status and resolution time.
- Unknown ID: explicit domain error.
- Already resolved ID: idempotent result without replacing the original resolution time.
- Validate the returned incident against the incident output schema.

## Shared persistence seed

The current `npm run seed` command upserts the canonical service/alert fixtures
in `data/ops-store.json`, preserving additional records. It requires no database
server. Sequelize/MySQL models are retained for a future persistence adapter.
