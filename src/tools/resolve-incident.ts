import { tool } from "@langchain/core/tools";
import { incidentSchema, resolveIncidentInputSchema } from "../domain/domain.ts";
import type { OpsService } from "../domain/ops-service.ts";
import { approvalRequiredFor } from "../approval/approval-context.ts";
import { ApprovalRequiredError } from "../approval/approval-errors.ts";
import { proposeResolution } from "../approval/approval-service.ts";

export function createResolveIncidentTool(service: OpsService) {
  return tool(
    async ({ id }) => {
      // Through /chat, resolving needs a human decision first (the tool body never runs here).
      if (approvalRequiredFor("resolve_incident")) throw new ApprovalRequiredError(proposeResolution(id));
      const result = incidentSchema.parse(service.resolveIncident(id));
      return JSON.stringify(result);
    },
    {
      name: "resolve_incident",
      description: "Resolve um incidente quando a mitigação foi concluída e a recuperação foi confirmada. Informe id com o identificador retornado ao abrir o incidente ou pela listagem de incidentes; não resolva incidentes apenas porque o alerta deixou de disparar. Exemplo: resolva incident-001 após validar a recuperação do serviço.",
      schema: resolveIncidentInputSchema,
    },
  );
}
