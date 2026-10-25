import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { incidentSchema, listIncidentsInputSchema } from "../domain/domain.ts";
import type { OpsService } from "../domain/ops-service.ts";

export function createListIncidentesTool(service: OpsService) {
  return tool(
    async ({ status }) => {
      const result = z.array(incidentSchema).parse(service.listIncidents(status));
      return JSON.stringify(result);
    },
    {
      name: "list_incidentes",
      description: "Lista incidentes para investigar problemas ativos ou revisar resoluções. Use quando perguntarem quais incidentes estão abertos ou sobre o histórico. O campo status aceita open | resolved | all e, se omitido, usa open. Exemplo: use status=resolved para revisar incidentes encerrados.",
      schema: listIncidentsInputSchema,
    },
  );
}
