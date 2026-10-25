# Data Model: OpsPilot Reasoning Core

## Service

Represents a monitored application/service.

| Field | Type | Rules |
|---|---|---|
| `id` | string | Stable slug primary identifier; non-empty. |
| `name` | string | Required display name. |
| `description` | string | Required short description. |

One service has zero or more alerts and incidents. The shared seed fixture has
exactly five unique service IDs.

## Alert

Represents a monitoring signal for one service.

| Field | Type | Rules |
|---|---|---|
| `id` | string | Stable seed identifier / database primary key. |
| `serviceId` | string | Required reference to an existing service. |
| `title` | string | Required alert summary. |
| `severity` | enum | `critical`, `high`, `medium`, or `low`. |
| `status` | enum | `firing` or `resolved`. |
| `createdAt` | date/time | Required event creation time; fixture timestamps are fixed. |

The memory store supports filtering by `firing`, `resolved`, and `all`.
The shared seed fixture has six unique alerts: exactly three firing and three
resolved. A service can have multiple alerts.

## Incident

Represents a tracked response to an operational issue.

| Field | Type | Rules |
|---|---|---|
| `id` | string | Unique identifier assigned when an incident is opened. |
| `title` | string | Required non-empty title. |
| `serviceId` | string | Required reference to an existing service. |
| `severity` | enum | `critical`, `high`, `medium`, or `low`. |
| `status` | enum | `open` or `resolved`; new incidents start `open`. |
| `createdAt` | date/time | Assigned when opened. |
| `resolvedAt` | date/time or null | Null while open; assigned once resolved. |

Opening an incident for an unknown service returns a domain error. Resolving an
unknown incident returns a domain error. Resolving an already resolved incident
does not change its original resolution timestamp.

## Strategy result

One strategy's response to an input.

| Field | Type | Rules |
|---|---|---|
| `answer` | string | Final response, or an explicit bounded-run/error summary. |
| `trace` | TraceEvent[] | Ordered events produced during the run. |
| `metrics.llmCalls` | integer | Number of model invocations made by the run. |
| `metrics.latencyMs` | number | Non-negative elapsed milliseconds. |

## Trace event

Discriminated union on `type`: `thought`, `action`, `observation`, `plan`,
`critique`, or `answer`. All variants include an ordered event index and
human-readable content. `action` also carries `tool` and validated `args`.
An observation may carry a successful result or explicit error information.

## Persistence and fixture rules

- `data/ops-store.json` is the current local baseline database. It contains the
  canonical five services, six alerts, and an incidents collection.
- `npm run seed` validates and upserts the canonical service/alert fixtures by
  stable IDs. Repeated runs preserve additional records and do not duplicate the
  baseline.
- Each runtime store loads and validates the JSON snapshot, then copies records
  into isolated in-memory state. Tool-created incidents and resolutions remain
  local to that strategy run and never mutate the JSON baseline.
- Each arena strategy receives its own copy of that same initial memory state so
  strategy order and incident mutations cannot affect another strategy's run.
- Sequelize models for MySQL remain defined as a future persistence adapter;
  arena, tools, tests, and the current seed command do not connect to MySQL.
