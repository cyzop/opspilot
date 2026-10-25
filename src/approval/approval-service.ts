// Pure functions that describe a paused resolution and finish the turn after the decision.
import type { GraphNode, TraceEvent } from "../trace/trace.ts";
import type { ApprovalProposal } from "./approval-errors.ts";
import type { Approval } from "./approval-store.ts";

export function proposeResolution(id: string): ApprovalProposal {
  return { tool: "resolve_incident", args: { id }, target: id, description: `Resolver o incidente ${id}` };
}

export function pendingTraceEvent(approval: Approval, node: GraphNode): TraceEvent {
  return {
    type: "approval",
    node,
    content: `Aguardando aprovação: ${approval.description}`,
    approvalId: approval.id,
    decision: "pending",
    tool: approval.tool,
    target: approval.target,
  };
}

export const awaitingApprovalNote = (approval: Approval) =>
  `Aguardando aprovação do operador: ${approval.description}.`;

export type Execution = { ok: true; result: unknown } | { ok: false; message: string };

export interface DecisionOutcome {
  answer: string;
  trace: TraceEvent[];
}

export function decisionOutcome(input: {
  approval: Approval;
  decision: "approved" | "denied";
  execution?: Execution;
}): DecisionOutcome {
  const { approval, decision } = input;
  const target = approval.target;
  const decisionEvent: TraceEvent = {
    type: "approval",
    node: "response",
    content: decision === "approved"
      ? `Operador aprovou: ${approval.description}`
      : `Operador negou: ${approval.description}`,
    approvalId: approval.id,
    decision,
    tool: approval.tool,
    target,
  };

  if (decision === "denied") {
    const answer = `Resolução do incidente ${target} negada pelo operador; nada foi alterado.`;
    return { answer, trace: [decisionEvent, { type: "answer", node: "response", content: answer }] };
  }

  const execution = input.execution ?? { ok: false, message: "the action did not run" };
  const action: TraceEvent = {
    type: "action",
    node: "response",
    content: `Requested tool ${approval.tool}`,
    tool: approval.tool,
    args: { ...approval.args },
  };
  const observation: TraceEvent = {
    type: "observation",
    node: "response",
    content: execution.ok
      ? `Tool result: ${typeof execution.result === "string" ? execution.result : JSON.stringify(execution.result)}`
      : `Tool returned an error: ${execution.message}`,
  };
  const answer = execution.ok
    ? `Incidente ${target} resolvido após aprovação do operador.`
    : `A resolução do incidente ${target} foi aprovada, mas falhou: ${execution.message}`;
  return { answer, trace: [decisionEvent, action, observation, { type: "answer", node: "response", content: answer }] };
}
