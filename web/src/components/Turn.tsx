import type { Turn } from "../lib/chat-state.ts";
import { AgentAnswer } from "./AgentAnswer.tsx";
import { ApprovalCard } from "./ApprovalCard.tsx";
import { ErrorNotice } from "./ErrorNotice.tsx";

export interface TurnHandlers {
  onRetry: (turnId: string) => void;
  onDecide: (turnId: string, approvalId: string, decision: "approve" | "deny") => void;
}

export function TurnView({ turn, busy, onRetry, onDecide }: { turn: Turn; busy: boolean } & TurnHandlers) {
  return (
    <li className="turn">
      <div className="bubble bubble-operator">
        <span className="visually-hidden">Você: </span>
        <p className="bubble-text">{turn.message}</p>
      </div>
      <div className="agent-slot">
        {turn.status === "sending" ? <Skeleton /> : null}
        {turn.status === "answered" ? <AgentAnswer answer={turn.answer} trace={turn.trace} metrics={turn.metrics} /> : null}
        {turn.status === "awaiting_approval" ? <ApprovalCard turn={turn} busy={busy} onDecide={onDecide} /> : null}
        {turn.status === "failed" ? (
          <ErrorNotice error={turn.error} onRetry={() => onRetry(turn.id)} disabled={busy} />
        ) : null}
      </div>
    </li>
  );
}

function Skeleton() {
  return (
    <div className="skeleton" role="status" aria-label="OpsPilot está analisando">
      <span className="skeleton-line" />
      <span className="skeleton-line" />
      <span className="skeleton-line skeleton-line-short" />
    </div>
  );
}
