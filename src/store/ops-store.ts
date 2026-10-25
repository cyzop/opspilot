import {
  alertFilterSchema,
  alertSchema,
  getRunbookInputSchema,
  incidentSchema,
  incidentFilterSchema,
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
  UnknownIncidentError,
  UnknownRunbookError,
  UnknownServiceError,
} from "../domain/errors.ts";
import { readOpsDatabase } from "./ops-database.ts";
import { runbookFixtures } from "./seed-data.ts";

export interface OpsStoreSeed {
  services: readonly ServiceRecord[];
  alerts: readonly AlertRecord[];
  incidents?: readonly IncidentRecord[];
  runbooks?: readonly RunbookRecord[];
}

export interface OpsStoreOptions {
  seed?: OpsStoreSeed;
  databasePath?: string;
  now?: () => Date;
}

export interface OpsStore {
  listServices(): ServiceRecord[];
  listAlerts(status?: AlertFilter): AlertRecord[];
  listIncidents(status?: IncidentFilter): IncidentRecord[];
  openIncident(input: OpenIncidentInput): IncidentRecord;
  resolveIncident(id: string): IncidentRecord;
  getRunbook(service: string): RunbookRecord;
}

export class InMemoryOpsStore implements OpsStore {
  private readonly services: ServiceRecord[];
  private readonly alerts: AlertRecord[];
  private readonly incidents: IncidentRecord[];
  private readonly runbooks: RunbookRecord[];
  private readonly now: () => Date;
  private incidentCounter = 0;

  constructor(options: OpsStoreOptions = {}) {
    const seed = options.seed ?? readOpsDatabase(options.databasePath);
    this.services = seed.services.map((service) => serviceSchema.parse(service));
    this.alerts = seed.alerts.map((alert) => alertSchema.parse(alert));
    this.incidents = (seed.incidents ?? []).map((incident) => incidentSchema.parse(incident));
    this.runbooks = (options.seed?.runbooks ?? runbookFixtures)
      .map((runbook) => runbookSchema.parse(runbook));
    this.now = options.now ?? (() => new Date());

    const serviceIds = new Set(this.services.map(({ id }) => id));
    for (const record of [...this.alerts, ...this.incidents]) {
      if (!serviceIds.has(record.serviceId)) {
        throw new UnknownServiceError(`Record ${record.id} references unknown service ${record.serviceId}.`);
      }
    }
  }

  listServices(): ServiceRecord[] {
    return this.services.map((service) => serviceSchema.parse(service));
  }

  listAlerts(status: AlertFilter = "firing"): AlertRecord[] {
    const validatedStatus = alertFilterSchema.parse(status);
    return [...this.alerts]
      .filter((alert) => validatedStatus === "all" || alert.status === validatedStatus)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((alert) => alertSchema.parse(alert));
  }

  listIncidents(status: IncidentFilter = "all"): IncidentRecord[] {
    const validatedStatus = incidentFilterSchema.parse(status);
    return [...this.incidents]
      .filter((incident) => validatedStatus === "all" || incident.status === validatedStatus)
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((incident) => incidentSchema.parse(incident));
  }

  openIncident(input: OpenIncidentInput): IncidentRecord {
    const validated = openIncidentInputSchema.parse(input);
    if (!this.services.some((service) => service.id === validated.service)) {
      throw new UnknownServiceError(`Unknown service: ${validated.service}`);
    }
    let id: string;
    do {
      this.incidentCounter += 1;
      id = `incident-${String(this.incidentCounter).padStart(3, "0")}`;
    } while (this.incidents.some((existing) => existing.id === id));
    const timestamp = this.now().toISOString();
    const incident = incidentSchema.parse({
      id,
      title: validated.title,
      serviceId: validated.service,
      severity: validated.severity,
      status: "open",
      createdAt: timestamp,
      resolvedAt: null,
      summary: null,
    });
    this.incidents.push(incident);
    return incidentSchema.parse(incident);
  }

  resolveIncident(id: string): IncidentRecord {
    const { id: validatedId } = resolveIncidentInputSchema.parse({ id });
    const incident = this.incidents.find(({ id: incidentId }) => incidentId === validatedId);
    if (!incident) {
      throw new UnknownIncidentError(`Unknown incident: ${validatedId}`);
    }
    if (incident.status === "open") {
      incident.status = "resolved";
      incident.resolvedAt = this.now().toISOString();
      incident.summary ??= incident.title;
    }
    return incidentSchema.parse(incident);
  }

  getRunbook(service: string): RunbookRecord {
    const validated = getRunbookInputSchema.parse({ service });
    const runbook = this.runbooks.find(({ service: runbookService }) => runbookService === validated.service);
    if (!runbook) {
      throw new UnknownRunbookError(`Unknown runbook for service: ${validated.service}`);
    }
    return runbookSchema.parse(runbook);
  }
}

export function createOpsStore(options: OpsStoreOptions = {}): OpsStore {
  return new InMemoryOpsStore(options);
}
