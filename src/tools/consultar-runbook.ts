import { tool } from "@langchain/core/tools";
import { runbookSchema, getRunbookInputSchema } from "../domain/domain.ts";
import type { OpsService } from "../domain/ops-service.ts";

export function createConsultarRunbookTool(service: OpsService) {
  return tool(
    async ({ service: serviceId }) => {
      const result = runbookSchema.parse(service.getRunbook(serviceId));
      return JSON.stringify(result);
    },
    {
      name: "consultar_runbook",
      description: "Consulta procedimentos operacionais antes de executar uma mitigação ou quando for necessário seguir passos de recuperação. Informe service com o identificador checkout, payments ou auth. Retorna o resumo e os passos do runbook; não substitui validação do estado atual do serviço. Exemplo: consulte o runbook de payments antes de repetir uma autorização.",
      schema: getRunbookInputSchema,
    },
  );
}
