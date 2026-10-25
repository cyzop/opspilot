import type { Metrics } from "../lib/api-schemas.ts";

export function MetricsSummary({ metrics }: { metrics: Metrics }) {
  const rows: Array<[string, string]> = [
    ["Modelo", metrics.modelUsed],
    ["Chamadas ao modelo", String(metrics.llmCalls)],
    ["Latência (ms)", String(Math.round(metrics.latencyMs))],
    ["Tokens de prompt", metrics.promptTokens === null ? "não disponível" : String(metrics.promptTokens)],
  ];
  return (
    <dl className="details" aria-label="Métricas do turno">
      {rows.map(([label, value]) => (
        <div key={label} style={{ display: "contents" }}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
