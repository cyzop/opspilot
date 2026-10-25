import { tool } from "@langchain/core/tools";
import { z } from "zod";

const providerStatusSchema = z.object({
  status: z.object({
    indicator: z.string().trim().min(1),
    description: z.string().trim().min(1),
  }),
});

const providerInputSchema = z.object({
  provider: z.enum(["github", "cloudflare"])
    .default("github")
    .describe("Provedor cuja página pública de status deve ser consultada: github ou cloudflare. Use cloudflare para dependências atendidas pela Cloudflare; o padrão é github."),
}).strict();

const statusUrls = {
  github: "https://www.githubstatus.com/api/v2/status.json",
  cloudflare: "https://www.cloudflarestatus.com/api/v2/status.json",
} as const;

type Provider = keyof typeof statusUrls;
type ProviderFetch = typeof fetch;

function readableError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").trim() || "falha desconhecida";
}

function failureResult(provider: Provider, details: string): string {
  return `Não consegui consultar o status de ${provider} (${details}). Responda com base nos alertas internos e avise o plantonista da limitação.`;
}

export function createCheckProviderStatusTool(doFetch: ProviderFetch = fetch) {
  return tool(
    async ({ provider }) => {
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        let response: Response;
        try {
          response = await doFetch(statusUrls[provider], {
            signal: AbortSignal.timeout(5_000),
          });
        } catch (error) {
          if (attempt === 1) continue;
          return failureResult(provider, readableError(error));
        }

        if (response.status >= 500) {
          if (attempt === 1) continue;
          return failureResult(provider, `a página de status respondeu HTTP ${response.status}`);
        }

        if (!response.ok) {
          return `A página de status de ${provider} respondeu HTTP ${response.status}.`;
        }

        let body: unknown;
        try {
          body = await response.json();
        } catch (error) {
          return failureResult(provider, `resposta JSON inválida: ${readableError(error)}`);
        }

        const parsed = providerStatusSchema.safeParse(body);
        if (!parsed.success) {
          return failureResult(provider, "resposta de status inválida ou incompleta");
        }

        const { indicator, description } = parsed.data.status;
        return `${provider} está ${indicator.replace(/\s+/g, " ").trim()} - ${description.replace(/\s+/g, " ").trim()}`;
      }

      return failureResult(provider, "tentativas esgotadas");
    },
    {
      name: "check_provider_status",
      description: "Consulta o status público do GitHub ou Cloudflare quando houver suspeita de problema externo, para distinguir se o incidente é nosso ou do provedor, ou quando uma dependência estiver fora do ar. É uma observação consultiva e não substitui a investigação dos alertas internos.",
      schema: providerInputSchema,
    },
  );
}
