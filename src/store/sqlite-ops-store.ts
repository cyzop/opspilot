import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  alertFilterSchema,
  alertSchema,
  getRunbookInputSchema,
  incidentFilterSchema,
  incidentSchema,
  openIncidentInputSchema,
  resolveIncidentInputSchema,
  runbookSchema,
  serviceSchema,
  type AlertFilter,
  type AlertRecord,
  type IncidentFilter,
  type IncidentRecord,
  type OpenIncidentInput,
  type RunbookRecord,
  type ServiceRecord,
} from "../domain/domain.ts";
import {
  DomainValidationError,
  UnknownIncidentError,
  UnknownRunbookError,
  UnknownServiceError,
} from "../domain/errors.ts";
import type { OpsStore, OpsStoreSeed } from "./ops-store.ts";
import { runbookFixtures } from "./seed-data.ts";

const defaultSqliteSeed: OpsStoreSeed = {
  services: [
    { id: "checkout", name: "Checkout", description: "Customer checkout and order creation." },
    { id: "payments", name: "Payments API", description: "Payment authorization and settlement." },
    { id: "auth", name: "Authentication", description: "Customer sign-in and token validation." },
    { id: "database", name: "Primary Database", description: "Primary transactional database." },
    { id: "catalog", name: "Catalog", description: "Product catalog and inventory browsing." },
  ].map((service) => serviceSchema.parse(service)),
  alerts: [
    {
      id: "alert-checkout-errors",
      serviceId: "checkout",
      title: "Checkout error rate above 5 percent",
      severity: "high",
      status: "firing",
      createdAt: "2026-10-01T08:05:00.000Z",
    },
    {
      id: "alert-api-latency",
      serviceId: "payments",
      title: "Payment API p95 latency above 2 seconds",
      severity: "critical",
      status: "firing",
      createdAt: "2026-10-01T08:00:00.000Z",
    },
    {
      id: "alert-auth-failures",
      serviceId: "auth",
      title: "Authentication failures above service objective",
      severity: "high",
      status: "firing",
      createdAt: "2026-10-01T08:10:00.000Z",
    },
    {
      id: "alert-database-cpu",
      serviceId: "database",
      title: "Primary database CPU saturation",
      severity: "critical",
      status: "resolved",
      createdAt: "2026-10-01T07:00:00.000Z",
    },
    {
      id: "alert-payment-timeout",
      serviceId: "payments",
      title: "Upstream payment provider timeouts",
      severity: "high",
      status: "resolved",
      createdAt: "2026-10-01T07:15:00.000Z",
    },
    {
      id: "alert-catalog-sync",
      serviceId: "catalog",
      title: "Catalog synchronization delay",
      severity: "medium",
      status: "resolved",
      createdAt: "2026-10-01T06:45:00.000Z",
    },
  ].map((alert) => alertSchema.parse(alert)),
  incidents: [],
  runbooks: runbookFixtures,
};

const schemaSql = `
  CREATE TABLE IF NOT EXISTS services (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS alerts (
    id TEXT PRIMARY KEY NOT NULL,
    service_id TEXT NOT NULL REFERENCES services(id),
    title TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
    status TEXT NOT NULL CHECK (status IN ('firing', 'resolved')),
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS incidentes (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    service_id TEXT NOT NULL REFERENCES services(id),
    severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
    status TEXT NOT NULL CHECK (status IN ('open', 'resolved')),
    created_at TEXT NOT NULL,
    resolved_at TEXT,
    summary TEXT
  );

  CREATE TABLE IF NOT EXISTS runbooks (
    service TEXT PRIMARY KEY NOT NULL REFERENCES services(id),
    name TEXT NOT NULL,
    summary TEXT NOT NULL,
    steps TEXT NOT NULL
  );
`;

function serviceFromRow(row: Record<string, unknown>): ServiceRecord {
  return serviceSchema.parse({
    id: row.id,
    name: row.name,
    description: row.description,
  });
}

function alertFromRow(row: Record<string, unknown>): AlertRecord {
  return alertSchema.parse({
    id: row.id,
    serviceId: row.service_id,
    title: row.title,
    severity: row.severity,
    status: row.status,
    createdAt: row.created_at,
  });
}

function incidentFromRow(row: Record<string, unknown>): IncidentRecord {
  return incidentSchema.parse({
    id: row.id,
    title: row.title,
    serviceId: row.service_id,
    severity: row.severity,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    summary: row.summary,
  });
}

function runbookFromRow(row: Record<string, unknown>): RunbookRecord {
  if (typeof row.steps !== "string") {
    throw new DomainValidationError("Stored runbook steps must be serialized as JSON text.");
  }
  const steps: unknown = JSON.parse(row.steps);
  return runbookSchema.parse({
    service: row.service,
    name: row.name,
    summary: row.summary,
    steps,
  });
}

export class SqliteOpsStore implements OpsStore {
  readonly _db: DatabaseSync;
  private readonly now: () => Date;

  constructor(
    path = process.env.OPSPILOT_DB ?? "./data/opspilot.db",
    options: { seed?: OpsStoreSeed; now?: () => Date } = {},
  ) {
    if (path !== ":memory:") {
      mkdirSync(dirname(resolve(path)), { recursive: true });
    }
    this._db = new DatabaseSync(path);
    this.now = options.now ?? (() => new Date());

    try {
      this._db.prepare("PRAGMA foreign_keys = ON").run();
      this._db.exec(schemaSql);
      this.seed(options.seed ?? defaultSqliteSeed);
    } catch (error) {
      this._db.close();
      throw error;
    }
  }

  listServices(): ServiceRecord[] {
    return this._db.prepare("SELECT id, name, description FROM services ORDER BY id")
      .all()
      .map(serviceFromRow);
  }

  listAlerts(status: AlertFilter = "firing"): AlertRecord[] {
    const validatedStatus = alertFilterSchema.parse(status);
    const statement = validatedStatus === "all"
      ? this._db.prepare("SELECT id, service_id, title, severity, status, created_at FROM alerts ORDER BY id")
      : this._db.prepare("SELECT id, service_id, title, severity, status, created_at FROM alerts WHERE status = ? ORDER BY id");
    const rows = validatedStatus === "all" ? statement.all() : statement.all(validatedStatus);
    return rows.map(alertFromRow);
  }

  listIncidents(status: IncidentFilter = "all"): IncidentRecord[] {
    const validatedStatus = incidentFilterSchema.parse(status);
    const statement = validatedStatus === "all"
      ? this._db.prepare("SELECT id, title, service_id, severity, status, created_at, resolved_at, summary FROM incidentes ORDER BY created_at, id")
      : this._db.prepare("SELECT id, title, service_id, severity, status, created_at, resolved_at, summary FROM incidentes WHERE status = ? ORDER BY created_at, id");
    const rows = validatedStatus === "all" ? statement.all() : statement.all(validatedStatus);
    return rows.map(incidentFromRow);
  }

  openIncident(input: OpenIncidentInput): IncidentRecord {
    const validated = openIncidentInputSchema.parse(input);
    const service = this._db.prepare("SELECT id FROM services WHERE id = ?").get(validated.service);
    if (!service) {
      throw new UnknownServiceError(`Unknown service: ${validated.service}`);
    }

    const existingId = this._db.prepare("SELECT id FROM incidentes WHERE id = ?");
    let id: string;
    let nextId = 1;
    do {
      id = `incident-${String(nextId).padStart(3, "0")}`;
      nextId += 1;
    } while (existingId.get(id));

    const createdAt = this.now().toISOString();
    this._db.prepare(`
      INSERT INTO incidentes (id, title, service_id, severity, status, created_at, resolved_at, summary)
      VALUES (?, ?, ?, ?, 'open', ?, NULL, NULL)
    `).run(id, validated.title, validated.service, validated.severity, createdAt);
    return this.getIncident(id);
  }

  resolveIncident(id: string): IncidentRecord {
    const { id: validatedId } = resolveIncidentInputSchema.parse({ id });

    const incident = this.getIncident(validatedId);
    if (incident.status === "open") {
      this._db.prepare(`
        UPDATE incidentes
        SET status = 'resolved', resolved_at = ?, summary = ?
        WHERE id = ?
      `).run(this.now().toISOString(), incident.title, validatedId);
    }
    return this.getIncident(validatedId);
  }

  getRunbook(service: string): RunbookRecord {
    const validated = getRunbookInputSchema.parse({ service });
    const row = this._db.prepare(
      "SELECT service, name, summary, steps FROM runbooks WHERE service = ?",
    ).get(validated.service);
    if (!row) {
      throw new UnknownRunbookError(`Unknown runbook for service: ${validated.service}`);
    }
    return runbookFromRow(row);
  }

  close(): void {
    this._db.close();
  }

  private getIncident(id: string): IncidentRecord {
    const row = this._db.prepare(`
      SELECT id, title, service_id, severity, status, created_at, resolved_at, summary
      FROM incidentes
      WHERE id = ?
    `).get(id);
    if (!row) {
      throw new UnknownIncidentError(`Unknown incident: ${id}`);
    }
    return incidentFromRow(row);
  }

  private seed(seed: OpsStoreSeed): void {
    const services = seed.services.map((service) => serviceSchema.parse(service));
    const alerts = seed.alerts.map((alert) => alertSchema.parse(alert));
    const incidents = (seed.incidents ?? []).map((incident) => incidentSchema.parse(incident));
    const runbooks = (seed.runbooks ?? []).map((runbook) => runbookSchema.parse(runbook));
    const serviceIds = new Set(services.map(({ id }) => id));
    for (const record of [...alerts, ...incidents]) {
      if (!serviceIds.has(record.serviceId)) {
        throw new UnknownServiceError(`Record ${record.id} references unknown service ${record.serviceId}.`);
      }
    }
    for (const runbook of runbooks) {
      if (!serviceIds.has(runbook.service)) {
        throw new UnknownServiceError(`Runbook ${runbook.name} references unknown service ${runbook.service}.`);
      }
    }

    this._db.prepare("BEGIN").run();
    try {
      const insertService = this._db.prepare(
        "INSERT OR IGNORE INTO services (id, name, description) VALUES (?, ?, ?)",
      );
      for (const service of services) {
        insertService.run(service.id, service.name, service.description);
      }

      const insertAlert = this._db.prepare(`
        INSERT OR IGNORE INTO alerts (id, service_id, title, severity, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const alert of alerts) {
        insertAlert.run(
          alert.id,
          alert.serviceId,
          alert.title,
          alert.severity,
          alert.status,
          alert.createdAt,
        );
      }

      const insertIncident = this._db.prepare(`
        INSERT OR IGNORE INTO incidentes
          (id, title, service_id, severity, status, created_at, resolved_at, summary)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const incident of incidents) {
        insertIncident.run(
          incident.id,
          incident.title,
          incident.serviceId,
          incident.severity,
          incident.status,
          incident.createdAt,
          incident.resolvedAt,
          incident.summary,
        );
      }

      const insertRunbook = this._db.prepare(`
        INSERT OR IGNORE INTO runbooks (service, name, summary, steps)
        VALUES (?, ?, ?, ?)
      `);
      for (const runbook of runbooks) {
        insertRunbook.run(
          runbook.service,
          runbook.name,
          runbook.summary,
          JSON.stringify(runbook.steps),
        );
      }
      this._db.prepare("COMMIT").run();
    } catch (error) {
      this._db.prepare("ROLLBACK").run();
      throw error;
    }
  }
}

export function createSqliteOpsStore(
  path = process.env.OPSPILOT_DB ?? "./data/opspilot.db",
  options: { seed?: OpsStoreSeed; now?: () => Date } = {},
): SqliteOpsStore {
  return new SqliteOpsStore(path, options);
}
