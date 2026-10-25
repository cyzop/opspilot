// Turns a typed trace event into what the trace list shows (pure).
import { isKnownTraceType, type KnownTraceEvent, type TraceEvent } from "./api-schemas.ts";
import type { TraceKind } from "../styles/tokens.ts";

export interface TraceDetail {
  label: string;
  value: string;
  /** Render as preformatted code (JSON). */
  code?: boolean;
}

export interface TraceItemView {
  key: string;
  kind: TraceKind;
  label: string;
  icon: string;
  node: string | null;
  content: string;
  details: TraceDetail[];
}

const LABELS: Record<TraceKind, { label: string; icon: string }> = {
  route: { label: "Rota", icon: "↪" },
  thought: { label: "Pensamento", icon: "💭" },
  action: { label: "Ação", icon: "🛠" },
  observation: { label: "Observação", icon: "👁" },
  plan: { label: "Plano", icon: "🗺" },
  critique: { label: "Crítica", icon: "🔍" },
  summarize: { label: "Resumo do histórico", icon: "🗂" },
  fallback: { label: "Modelo reserva", icon: "⇄" },
  approval: { label: "Aprovação", icon: "✋" },
  answer: { label: "Resposta", icon: "✔" },
  unknown: { label: "Etapa", icon: "•" },
};

const DECISIONS = { pending: "pendente", approved: "aprovada", denied: "negada" } as const;

const json = (value: unknown) => JSON.stringify(value, null, 2);

function details(event: KnownTraceEvent): TraceDetail[] {
  switch (event.type) {
    case "route":
      return [
        { label: "Rota escolhida", value: event.route },
        { label: "Origem", value: event.source },
        { label: "Motivo", value: event.reason },
      ];
    case "action":
      return [
        { label: "Ferramenta", value: event.tool },
        { label: "Argumentos", value: json(event.args), code: true },
      ];
    case "fallback":
      return [
        { label: "Troca", value: `${event.primaryModel} → ${event.reserveModel}` },
        { label: "Motivo", value: event.reason },
      ];
    case "summarize":
      return [
        { label: "Situação", value: event.status },
        { label: "Mensagens resumidas", value: String(event.messages) },
        { label: "Tokens estimados", value: event.estimatedTokens === null ? "não disponível" : String(event.estimatedTokens) },
      ];
    case "approval":
      return [
        { label: "Decisão", value: DECISIONS[event.decision] },
        { label: "Ferramenta", value: event.tool },
        { label: "Alvo", value: event.target },
      ];
    default:
      return [];
  }
}

function isKnown(event: TraceEvent): event is KnownTraceEvent {
  return isKnownTraceType(event.type);
}

export function toTraceItem(event: TraceEvent, index: number): TraceItemView {
  const node = typeof event.node === "string" ? event.node : null;
  if (isKnown(event)) {
    return { key: `${index}-${event.type}`, kind: event.type, ...LABELS[event.type], node, content: event.content, details: details(event) };
  }
  const content = typeof event.content === "string" ? event.content : "";
  return {
    key: `${index}-${event.type}`,
    kind: "unknown",
    label: `${LABELS.unknown.label} (${event.type})`,
    icon: LABELS.unknown.icon,
    node,
    content,
    details: [{ label: "Dados", value: json(event), code: true }],
  };
}
