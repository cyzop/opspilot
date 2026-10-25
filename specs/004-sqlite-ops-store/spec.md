# Feature Specification: SQLite Ops Persistence

**Feature Branch**: `004-sqlite-ops-store`

**Created**: 2026-10-09

**Status**: Draft

**Input**: User description: "Persistência real de operaçõess: - sqliteopstore (src/store/sqlite-ops-store.ts) implemente a interface OpsStore existente via node:sqlite (DatabaseSync); caminho em OPSPILOT_DB (default ./data/opspilot.db); ":memory:" nos testes - 4 tabelas - services, alerts, incidentes, runbooks - espelhando os tipos atuais do dominio (incidentes ganha resolved_at e summary, anuláveis); DDL idempotente no construtor; CHECK em todo campo de domínio fechado (tier, severity, status) - seed idempotente = cenário Mercadinho do mock (5 serviços, 6 alertas: 3 firing, 3 resolved; runbooks de checkout/payments/auth) - prepared statements em toda query; Sem SQL concatenado - tools novas: list_incidentes (status open | resolved | all, default open) e consultar_runbook (service) - descrições pelas 6 regras - composição injeta o sqliteopsstore; mock in memory fica para testes e para o bench (cenarios possam ser reproduzidos) - data/ no .gitignore - revisar descrições de src/agents/tools.ts pelas 6 regas (dívida do open_incident: quando usar; .describe() em todo campo; enums) - testes ":memory:" seed, abrir/listar/resolver, filtros e CHECKS; testes das tools existentes passam a rodar sobre ":memory""

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Persist operational data in a durable local store (Priority: P1)

As an operations operator, I want the system to store services, alerts, incidents, and runbooks in a real local database so that production workflows remain consistent across restarts and no operational state is lost in memory alone.

**Why this priority**: Reliable persistence is the foundation for production operations, auditing, and recovery.

**Independent Test**: Initialize the SQLite-backed store with a fresh database, seed the standard Mercadinho scenario, and verify the persisted records are available after a restart-like re-open of the store.

**Acceptance Scenarios**:

1. **Given** a valid local SQLite database path, **When** the store is created, **Then** the schema is created idempotently and the system is ready to persist domain data without errors.
2. **Given** the project is configured for test execution, **When** the database is set to `:memory:`, **Then** the same store contract works without requiring a file-based database.
3. **Given** the standard Mercadinho scenario, **When** the seed process runs, **Then** the persisted records match the expected counts and domain values for services, alerts, incidents, and runbooks.

---

### User Story 2 - Query and manage incidents with valid filters and lifecycle states (Priority: P1)

As an operations lead, I want to open, list, and resolve incidents using clear filters and normalized status values so that I can safely investigate active issues and track closure with a consistent audit trail.

**Why this priority**: Operators make decisions from the state of open and resolved incidents, and incorrect statuses or filters would lead to poor operational outcomes.

**Independent Test**: Create a database with seeded alerts and incidents, query the incident list by status, and verify open/resolved/all filtering and resolution timestamps behave as expected.

**Acceptance Scenarios**:

1. **Given** a request to list incidents with default behavior, **When** no status is specified, **Then** only open incidents are returned.
2. **Given** a request to list incidents with `status=resolved`, **When** the query is executed, **Then** only resolved incidents are returned.
3. **Given** an incident is resolved, **When** the resolution step is recorded, **Then** the incident is marked resolved and includes a `resolved_at` timestamp and summary.
4. **Given** a malformed or unsupported domain value is submitted, **When** validation runs, **Then** the system rejects it before persisting or returning a result.

---

### User Story 3 - Expose operational tools and runbook lookup consistently (Priority: P2)

As an OpsPilot operator, I want the chat and agent tooling layer to provide clear incident listing and runbook retrieval actions so that I can inspect status and find the right operational guidance without relying on ad hoc memory.

**Why this priority**: Tool descriptions and structured filters make operational guidance accurate, safe, and easier to use during incident response.

**Independent Test**: Invoke the new tool interfaces against the SQLite-backed store and verify the tool result shapes, enum values, and descriptive guidance align with the supported operational states.

**Acceptance Scenarios**:

1. **Given** an operator asks to list incidents, **When** the tool is used, **Then** the supported filter values are described clearly and the default is `open`.
2. **Given** an operator asks to consult a runbook for a service, **When** the service name is provided, **Then** the matching guidance is returned in a predictable and validated shape.
3. **Given** a tool description is reviewed, **When** the action is implemented, **Then** each field uses a clear `.describe()` contract, enums are explicit, and the open-incident guidance explains when the tool should be used.

---

### Edge Cases

- The database path is missing or a directory is not writable.
- The process starts with an existing SQLite file containing prior schema state.
- The store receives an invalid domain enum value for severity or status.
- The system attempts to insert duplicate seed data while the database already contains records.
- An incident is created for a service or alert that does not exist in the current dataset.
- The request asks for an unsupported incident status filter value.
- Tests execute against `:memory:` and must not leak records between test cases.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide a real SQLite-backed operation store that implements the existing `OpsStore` contract.
- **FR-002**: The system MUST use the `OPSPILOT_DB` environment variable to determine the database path and MUST default to `./data/opspilot.db` when it is unset.
- **FR-003**: The system MUST support `:memory:` for test execution without changing the public store contract.
- **FR-004**: The system MUST persist the domain entities `services`, `alerts`, `incidentes`, and `runbooks` with one record per entity type, matching the current domain model.
- **FR-005**: The system MUST include the required `resolved_at` and `summary` fields on incidents and MUST allow them to be nullable where the domain model permits it.
- **FR-006**: The system MUST create the schema idempotently when the store is constructed so that repeated initialization does not fail or duplicate tables.
- **FR-007**: The system MUST enforce database constraints over every closed enum defined by the current domain, including severity and status values. The current Service domain has no `tier` field, so this feature MUST NOT introduce one.
- **FR-008**: The system MUST run seed data idempotently to reproduce the standard Mercadinho scenario: 5 services, 6 alerts with 3 firing and 3 resolved, and runbooks for checkout, payments, and auth.
- **FR-009**: The system MUST use prepared statements for all database operations and MUST avoid concatenated SQL strings.
- **FR-010**: The system MUST expose the new `list_incidentes` tool with support for `open`, `resolved`, and `all` filters and a default of `open`.
- **FR-011**: The system MUST expose the new `consultar_runbook` tool for a service, returning the matching operational guidance in a structured and validated shape.
- **FR-012**: The system MUST align tool descriptions with the project’s six description rules, including explicit usage guidance for `open_incident`, clear field explanations, and enum definitions.
- **FR-013**: The application composition layer MUST inject the SQLite-backed implementation while preserving the in-memory mock option for tests and benchmark scenario reproduction.
- **FR-014**: The system MUST keep the `data/` directory out of version control and MUST not commit runtime database files.
- **FR-015**: The system MUST support test runs against `:memory:` for seed, open/list/resolve flows, filtering, and schema validation checks without cross-test leakage.
- **FR-016**: The system MUST ensure the tool tests for existing operations continue to pass using an isolated SQLite `:memory:` database.

### Key Entities

- **Service**: A supported operational unit with a stable identity, name, and description.
- **Alert**: A generated operating signal that indicates a service state change and carries domain-level severity and status information.
- **Incidente**: A tracked operational issue representing a service problem, its resolution state, and the associated summary metadata.
- **Runbook**: A documented operational response for a service, such as checkout, payments, or authentication guidance.
- **Ops Store**: The persistence boundary that provides a consistent contract for reading and writing the domain entities.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of seeded domain records are created exactly once per initialization and remain available after the store is reopened.
- **SC-002**: 100% of list operations for incidents respect the requested filter and return the correct open/resolved values by default and when explicitly set.
- **SC-003**: 100% of domain enum writes are rejected when they do not match the allowed values for severity or status.
- **SC-004**: 100% of generated responses from the tool layer include clear descriptions, explicit enum values, and guidance that explains when to use the action.
- **SC-005**: The production path persists real operational data while the test and benchmark path continues to support in-memory scenarios without losing reproducibility.
- **SC-006**: 100% of store operations avoid concatenated SQL and perform validation through prepared statements.

## Assumptions

- The project already has a domain model that defines the current operational entities and their rules, and this feature is intended to align the persistence layer with that model rather than redesign it.
- The default deployment environment is a local workstation or ephemeral runtime with a writable `data/` directory, while test environments use in-memory storage for isolation.
- The seed dataset represents the standard Mercadinho scenario expected by existing benchmark and test fixtures and will be kept idempotent across repeated runs.
- Existing tool descriptions are already close to the required operational semantics, so the change is primarily a tightening of validation, enumeration, and action guidance rather than a broader product shift.
