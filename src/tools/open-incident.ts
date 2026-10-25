import { tool } from "@langchain/core/tools";
import { incidentSchema, openIncidentInputSchema } from "../domain/domain.ts";
import type { OpsService } from "../domain/ops-service.ts";

export function createOpenIncidentTool(service: OpsService) {
  return tool(
    async (input) => {
      const result = incidentSchema.parse(service.openIncident(openIncidentInputSchema.parse(input)));
      return JSON.stringify(result);
    },
    {
      name: "open_incidente",
      description: "Abre um incidente quando houver um problema operacional confirmado que exija acompanhamento; use após identificar o serviço afetado e antes de iniciar ações de mitigação. Informe title como resumo curto, service como identificador conhecido e severity como critical, high, medium ou low. Exemplo: abra um incidente high para checkout quando a taxa de erros estiver elevada.",
      schema: openIncidentInputSchema,
    },
  );
}
