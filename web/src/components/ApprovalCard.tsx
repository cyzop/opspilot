import { useId } from "react";
import type { Turn } from "../lib/chat-state.ts";
import { AgentAnswer } from "./AgentAnswer.tsx";
import { ErrorNotice } from "./ErrorNotice.tsx";
import { TraceToggle } from "./TraceToggle.tsx";

type ApprovalTurn = Extract<Turn, { status: "awaiting_approval" }>;

const TOOL_LABELS: Record<string, string> = { resolve_incident: "Resolver incidente" };

const STATUS = {
  approved: { icon: "✔", text: "Aprovado", className: "status-approved" },
  denied: { icon: "✖", text: "Negado", className: "status-denied" },
  not_pending: { icon: "⏱", text: "Não está mais pendente", className: "status-not-pending" },
} as const;

function timeOf(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function ApprovalCard({ turn, busy, onDecide }: {
  turn: ApprovalTurn;
  busy: boolean;
  onDecide: (turnId: string, approvalId: string, decision: "approve" | "deny") => void;
}) {
  const titleId = useId();
  const { approval, decision } = turn;
  const sending = decision === "sending";
  const open = decision === "idle" || sending;
  const status = decision === "approved" || decision === "denied" || decision === "not_pending" ? STATUS[decision] : null;

  return (
    <>
      <section className="approval-card" role="region" aria-labelledby={titleId} aria-busy={sending}>
        <h2 id={titleId} className="approval-title">
          <span aria-hidden="true">✋ </span>Aprovação necessária
        </h2>
        <p className="bubble-text">{approval.description}</p>
        <dl className="details">
          <dt>Ação</dt>
          <dd>{TOOL_LABELS[approval.tool] ?? approval.tool}</dd>
          <dt>Ferramenta</dt>
          <dd><code>{approval.tool}</code></dd>
          <dt>Alvo</dt>
          <dd>{approval.target}</dd>
          <dt>Argumentos</dt>
          <dd><pre>{JSON.stringify(approval.args, null, 2)}</pre></dd>
          <dt>Expira às</dt>
          <dd>{timeOf(approval.expiresAt)}</dd>
        </dl>
        {open ? (
          <div className="approval-actions">
            <button
              type="button"
              className="button button-primary"
              disabled={sending || busy}
              aria-busy={sending}
              onClick={() => onDecide(turn.id, approval.id, "approve")}
            >
              Aprovar
            </button>
            <button
              type="button"
              className="button"
              disabled={sending || busy}
              aria-busy={sending}
              onClick={() => onDecide(turn.id, approval.id, "deny")}
            >
              Negar
            </button>
          </div>
        ) : null}
        {status ? (
          <p className={`status-badge ${status.className}`} role="status">
            <span aria-hidden="true">{status.icon} </span>
            {status.text}
          </p>
        ) : null}
        {turn.decisionError ? <ErrorNotice error={turn.decisionError} /> : null}
        <TraceToggle trace={turn.trace} metrics={turn.metrics} />
      </section>
      {turn.final ? <AgentAnswer answer={turn.final.answer} trace={turn.final.trace} metrics={turn.final.metrics} /> : null}
    </>
  );
}
