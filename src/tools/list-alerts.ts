import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { alertFilterSchema, alertSchema } from "../domain/domain.ts";
import type { OpsService } from "../domain/ops-service.ts";

const listAlertsInputSchema = z.object({
  status: alertFilterSchema
    .describe("Filtro do alerta: firing, resolved ou all; o padrão é firing.")
    .default("firing"),
}).strict();

export function createListAlertsTool(service: OpsService) {
  return tool(
    async ({ status }) => {
      const result = z.array(alertSchema).parse(service.listAlerts(status));
      return JSON.stringify(result);
    },
    {
      name: "list_alerts",
      description: "Lista alertas para investigar sinais ativos ou revisar alertas resolvidos. Use quando perguntarem o que está disparando ou o estado do plantão. O campo status aceita firing | resolved | all e, se omitido, usa firing. Exemplo: use status=all para revisar todos os alertas.",
      schema: listAlertsInputSchema,
    },
  );
}
