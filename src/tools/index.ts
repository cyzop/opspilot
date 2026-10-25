import { OpsService } from "../domain/ops-service.ts";
import type { MemoryStore } from "../memory/memory-store.ts";
import { createOpsStore, type OpsStore } from "../store/ops-store.ts";
import { createListAlertsTool } from "./list-alerts.ts";
import { createListIncidentesTool } from "./list-incidentes.ts";
import { createOpenIncidentTool } from "./open-incident.ts";
import { createResolveIncidentTool } from "./resolve-incident.ts";
import { createConsultarRunbookTool } from "./consultar-runbook.ts";
import { createCheckProviderStatusTool } from "./check-provider-status.ts";
import { createForgetPreferenceTool } from "./forget-preference.ts";

export function createOpsTools(store: OpsStore, memoryStore?: MemoryStore) {
  const service = new OpsService(store);
  const tools = {
    listAlerts: createListAlertsTool(service),
    listIncidentes: createListIncidentesTool(service),
    consultarRunbook: createConsultarRunbookTool(service),
    openIncident: createOpenIncidentTool(service),
    resolveIncident: createResolveIncidentTool(service),
    checkProviderStatus: createCheckProviderStatusTool(),
  };

  if (!memoryStore) {
    return tools;
  }

  return {
    ...tools,
    forget_preference: createForgetPreferenceTool(memoryStore),
  };
}

export const opsTools = Object.values(createOpsTools(createOpsStore()));
