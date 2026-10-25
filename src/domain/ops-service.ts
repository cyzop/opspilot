import {
  getRunbookInputSchema,
  incidentFilterSchema,
  openIncidentInputSchema,
  type AlertFilter,
  type AlertRecord,
  type IncidentFilter,
  type IncidentRecord,
  type OpenIncidentInput,
  type RunbookRecord,
} from "./domain.ts";
import type { OpsStore } from "../store/ops-store.ts";

export class OpsService {
  constructor(private readonly store: OpsStore) {}

  listAlerts(status: AlertFilter): AlertRecord[] {
    return this.store.listAlerts(status);
  }

  listIncidents(status: IncidentFilter = "open"): IncidentRecord[] {
    return this.store.listIncidents(incidentFilterSchema.parse(status));
  }

  openIncident(input: OpenIncidentInput): IncidentRecord {
    return this.store.openIncident(openIncidentInputSchema.parse(input));
  }

  resolveIncident(id: string): IncidentRecord {
    return this.store.resolveIncident(id);
  }

  getRunbook(service: string): RunbookRecord {
    const validated = getRunbookInputSchema.parse({ service });
    return this.store.getRunbook(validated.service);
  }
}
