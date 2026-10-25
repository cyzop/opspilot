# Data Model: External Provider Status Check

This feature does not introduce persisted entities. It defines transient request and result values at the tool boundary.

## Provider selection

| Field | Type | Constraints | Notes |
|---|---|---|---|
| provider | enum string | `github` or `cloudflare`; optional, default `github` | Selects one of the fixed public status endpoints. |

## Provider status response

| Field | Type | Constraints | Notes |
|---|---|---|---|
| status | object | required | Statuspage response envelope. |
| status.indicator | string | required, non-empty after trimming | Reported exactly as published, e.g. `none`, `minor`, `major`, `critical`, or `maintenance`. |
| status.description | string | required, non-empty after trimming | Provider's human-readable status description. |

The tool validates the required `status` fields before formatting a result. Other top-level response fields are not required for the tool's output.

## Status check result

The tool returns a single-line string:

- Success: selected provider, indicator, and normalized description.
- Failure: selected provider and a readable failure explanation.

The tool result is an observation, not a domain mutation. No response is stored in SQLite or attached to incident state.
