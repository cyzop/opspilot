# Quickstart: SQLite Ops persistence validation

## Prerequisites

- Node.js 22 LTS
- Dependencies installed with `npm install`
- A local writable `data/` directory for the default database path

## Validate the SQLite-backed store

```powershell
npm test
npm run typecheck
```

Expected outcome:

- all tests pass; SQLite store tests and operation tool tests use isolated `:memory:` databases
- database constraints and seed logic are exercised
- benchmark and strategy scenarios retain their deterministic in-memory mock
- the seed contains 5 services, 6 alerts (3 firing and 3 resolved), and checkout, payments, and auth runbooks

## Run the production-like database flow

```powershell
$env:OPSPILOT_DB = "./data/opspilot.db"
npm run dev
```

Expected outcome:

- the application creates or reuses the SQLite file at `./data/opspilot.db`
- the schema is initialized idempotently
- the default Mercadinho scenario is present after startup

## Check a seeded runbook and incident list

Use the tool layer or direct store calls to verify:

1. `list_incidentes` defaults to open records.
2. `list_incidentes` accepts `resolved` and `all` filters.
3. `consultar_runbook` returns the matching operation guidance for a service.
4. the incident lifecycle resolves an open record and stores `resolved_at`.

## Validation signals

- schema creation is idempotent across repeated startups
- `CHECK` constraints reject invalid enum values
- seed runs without duplicate rows after repeated initialization
- all SQL is parameterized and no concatenated SQL is used in the store layer
