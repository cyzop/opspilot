# Research: SQLite-backed Ops persistence

## Decision: use native SQLite via `node:sqlite` and keep the in-memory mock for reproducible tests

The persistence layer will be implemented as a concrete `SqliteOpsStore` in `src/store/sqlite-ops-store.ts`, following the existing `OpsStore` contract in `src/store/ops-store.ts`. We will use the Node SQLite sync API (`DatabaseSync`) to keep the access model simple and explicit, while maintaining the current in-memory store as the test and benchmark default when reproducibility or isolation matters.

### Rationale

- The project already expects a clean boundary between domain logic and storage.
- The new requirement explicitly calls for a real SQLite implementation with `OPSPILOT_DB` support and `:memory:` for tests.
- The existing `InMemoryOpsStore` is already a stable contract and can remain as an adapter for tests and bench scenarios, avoiding unnecessary churn in the domain layer.

### Alternatives considered

- Keep the in-memory store as the only implementation: rejected because it violates the real persistence requirement.
- Use a higher-level ORM or Sequelize: rejected because the constitution and feature direction call for native SQLite and explicit prepared statements.
- Put seed logic or SQL directly in service code: rejected because it would spread persistence concerns outside the store boundary.

## Decision: one idempotent schema with explicit enum checks

The `SqliteOpsStore` constructor will run schema creation using `CREATE TABLE IF NOT EXISTS` statements. The schema will model the current domain records and will add the incident fields required by the feature (`resolved_at`, `summary`) while keeping nullable semantics aligned with the existing domain model.

### Rationale

- Idempotent schema creation ensures repeated startup is safe and supports tests that reopen the same DB path.
- Domain enums for alert/incident severity and alert/incident status will be validated on the database side with `CHECK` constraints to reduce invalid writes. The current Service type has no `tier` field and the feature will not introduce one.
- The domain layer already validates values with Zod; the SQLite layer adds a second enforcement boundary for better safety.

### Alternatives considered

- Let the application trust values passed from the domain layer: rejected because it leaves the storage boundary unguarded.
- Use dynamic SQL generation for enum validation: rejected because it would be harder to audit and inconsistent with prepared statements.

## Decision: use prepared statements for all queries and seed inserts

The store will use parameterized SQL for every read and write. No string interpolation will be used to build SQL, and the seed routine will reuse the same read/write layer to keep the behavior consistent.

### Rationale

- Prepared statements minimize SQL injection risk and keep the storage access deterministic.
- The project’s security principle calls for explicit boundaries and no concatenated SQL.
- Test coverage is easier to reason about when each store method has a single controlled SQL path.

### Alternatives considered

- Use `DatabaseSync.prepare` for only some queries: rejected as inconsistent with the requirement that all queries be prepared.
- Build SQL from JS strings for seed or filters: rejected because it violates the spec and weakens security guarantees.

## Decision: expose new operational tools for incident listing and runbook lookup

The tool layer will add `list_incidentes` and `consultar_runbook` next to the existing alert and incident tools. The descriptions must use the project’s six rules: explain when to use the tool, describe all fields, specify enum values, include default behavior, give clear examples of use, and keep the name intuitive for live operations.

### Rationale

- These tools are part of the operational workflow and must be discoverable to the agent.
- Incident state filters and runbook lookup are core operational decisions that should not be hidden behind vague descriptions.
- Tightening the tool descriptions improves reliability without changing the business model.

### Alternatives considered

- Reuse the generic `list_alerts` tool for all incident queries: rejected because the feature requires dedicated filters and explicit `open|resolved|all` semantics.
- Keep the runbook lookup undocumented: rejected because the agent needs an explicit retrieval tool for service-specific guidance.

## Decision: preserve the in-memory mock for tests and benchmarks while composing the SQLite store in production

The composition layer will instantiate `SqliteOpsStore` when the runtime is configured for production or local persistence, while preserving `createOpsStore()`/mock-based factories for the benchmark and deterministic tests. This keeps the codebase adaptable without forcing the same database lifecycle into every test environment.

### Rationale

- Existing tests are more reliable when they can run with an isolated `:memory:` store.
- Benchmarks and scenario replay benefit from a deterministic in-memory store as well.
- The feature explicitly calls for the mock store to remain available for tests and reproduction scenarios.

### Alternatives considered

- Replace the mock entirely with SQLite: rejected because it would reduce test isolation and break benchmark reproducibility.
- Add SQLite-only testing: rejected because the spec explicitly calls for a memory-backed test path.

## Decision: keep the database directory out of version control

The runtime database path will default to `./data/opspilot.db`, and the project will ignore `data/` in Git so that local operational state stays out of the repository.

### Rationale

- This matches the production/runtime expectation for a local SQLite database file.
- It avoids accidental credential or state leakage through Git history.
- The feature requirement explicitly calls for `data/` to be omitted from version control.

## Open technical consequences

The primary implementation risk is not the SQLite API itself but the need to align new storage behavior with the existing domain schema without breaking deterministic tests. The mitigation is to keep the migration surface small: store interface, SQLite adapter, domain updates, and two new tool definitions, all validated by the existing suite and targeted `:memory:` tests.
