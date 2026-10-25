# Data Model: SQLite OPS persistence

## Domain entities

### Service

| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | string | required, trimmed, non-empty | stable identifier for the service |
| name | string | required, trimmed, non-empty | human-readable service name |
| description | string | required, trimmed, non-empty | support summary or routing context |

**Relationships**: services are referenced by alerts and incidents; runbooks are scoped to a service.

### Alert

| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | string | required, trimmed, non-empty | unique alert identifier |
| serviceId | string | required, trimmed, non-empty | FK to a service |
| title | string | required, trimmed, non-empty | alert summary |
| severity | enum | `critical|high|medium|low` | enforced via `CHECK` at the DB layer |
| status | enum | `firing|resolved` | enforced via `CHECK` |
| createdAt | ISO datetime | required | created timestamp |

**Relationships**: many alerts may belong to one service.

### Incidente

| Field | Type | Constraints | Notes |
|---|---|---|---|
| id | string | required, trimmed, non-empty | unique incident identifier |
| title | string | required, trimmed, non-empty | incident summary |
| serviceId | string | required, trimmed, non-empty | FK to a service |
| severity | enum | `critical|high|medium|low` | enforced via `CHECK` |
| status | enum | `open|resolved` | enforced via `CHECK` |
| createdAt | ISO datetime | required | creation timestamp |
| resolvedAt | ISO datetime or null | nullable | set only when resolved |
| summary | string or null | nullable | added operational summary for resolved issue context |

**State transitions**: open -> resolved, with `resolvedAt` set when resolved and `summary` populated from the incident title; both fields remain nullable for open or imported records.

### Runbook

| Field | Type | Constraints | Notes |
|---|---|---|---|
| service | string | required, trimmed, non-empty | operational lookup key such as checkout, payments, or auth |
| name | string | required, trimmed, non-empty | runbook name (checkout, payments, auth) |
| summary | string | required, trimmed, non-empty | operational directive summary |
| steps | text | required | ordered guidance for operators |

**Relationships**: each runbook is retrieved by its service key and references a service record; the SQLite Mercadinho seed includes checkout, payments, and auth services.

## SQLite table plan

```sql
CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL,
  title TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  status TEXT NOT NULL CHECK (status IN ('firing', 'resolved')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (service_id) REFERENCES services(id)
);

CREATE TABLE IF NOT EXISTS incidentes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  service_id TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  status TEXT NOT NULL CHECK (status IN ('open', 'resolved')),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  summary TEXT,
  FOREIGN KEY (service_id) REFERENCES services(id)
);

CREATE TABLE IF NOT EXISTS runbooks (
  service TEXT PRIMARY KEY REFERENCES services(id),
  name TEXT NOT NULL,
  summary TEXT NOT NULL,
  steps TEXT NOT NULL
);
```

## Seed scenario

The store will reseed to the Mercadinho mock set idempotently:

- 5 services
- 6 alerts total, with 3 firing and 3 resolved
- 3 runbooks for checkout, payments, and auth
- incidents seeded according to the domain expectations used by the existing mock database

The insert logic will be idempotent so repeated constructor calls or repeated app restarts do not create duplicate rows.

## Validation rules

- `id`, `name`, `title`, `description`, `summary`, and `steps` must be non-empty after trimming.
- Alert and incident `serviceId` values must reference a known service record.
- Severity values are restricted to `critical|high|medium|low`.
- Alert status is restricted to `firing|resolved`.
- Incident status is restricted to `open|resolved`.
- Datetime values are validated using ISO 8601 strings at the domain boundary and stored as text in SQLite.
