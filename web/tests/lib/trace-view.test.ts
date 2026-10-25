import assert from "node:assert/strict";
import test from "node:test";
import { traceEventSchema, type TraceEvent } from "../../src/lib/api-schemas.ts";
import { toTraceItem } from "../../src/lib/trace-view.ts";

const ev = (raw: Record<string, unknown>): TraceEvent => traceEventSchema.parse(raw);

test("each known kind maps to its pt-BR label and details", () => {
  const route = toTraceItem(ev({ type: "route", content: "Route react", route: "react", reason: "consulta", source: "router", node: "router" }), 0);
  assert.equal(route.kind, "route");
  assert.equal(route.label, "Rota");
  assert.equal(route.node, "router");
  assert.deepEqual(route.details, [
    { label: "Rota escolhida", value: "react" },
    { label: "Origem", value: "router" },
    { label: "Motivo", value: "consulta" },
  ]);

  const action = toTraceItem(ev({ type: "action", content: "Requested tool list_alerts", tool: "list_alerts", args: { status: "firing" } }), 1);
  assert.equal(action.label, "Ação");
  assert.deepEqual(action.details, [
    { label: "Ferramenta", value: "list_alerts" },
    { label: "Argumentos", value: JSON.stringify({ status: "firing" }, null, 2), code: true },
  ]);

  const fallback = toTraceItem(ev({ type: "fallback", content: "x", primaryModel: "a/main", reserveModel: "b/reserve", reason: "503" }), 2);
  assert.equal(fallback.label, "Modelo reserva");
  assert.deepEqual(fallback.details[0], { label: "Troca", value: "a/main → b/reserve" });

  const approval = toTraceItem(ev({ type: "approval", content: "x", approvalId: "a1", decision: "pending", tool: "resolve_incident", target: "incident-001" }), 3);
  assert.equal(approval.label, "Aprovação");
  assert.deepEqual(approval.details, [
    { label: "Decisão", value: "pendente" },
    { label: "Ferramenta", value: "resolve_incident" },
    { label: "Alvo", value: "incident-001" },
  ]);

  const labels = ["thought", "observation", "plan", "critique", "answer"].map((type) => toTraceItem(ev({ type, content: "c" }), 0).label);
  assert.deepEqual(labels, ["Pensamento", "Observação", "Plano", "Crítica", "Resposta"]);
  const summary = toTraceItem(ev({ type: "summarize", content: "c", status: "ok", messages: 14, estimatedTokens: 320 }), 0);
  assert.equal(summary.label, "Resumo do histórico");
  assert.deepEqual(summary.details, [
    { label: "Situação", value: "ok" },
    { label: "Mensagens resumidas", value: "14" },
    { label: "Tokens estimados", value: "320" },
  ]);
});

test("an unknown kind becomes a generic step with its raw JSON", () => {
  const raw = { type: "novo", content: "algo", extra: 1 };
  const item = toTraceItem(ev(raw), 5);
  assert.equal(item.kind, "unknown");
  assert.equal(item.label, "Etapa (novo)");
  assert.equal(item.content, "algo");
  assert.deepEqual(item.details, [{ label: "Dados", value: JSON.stringify(raw, null, 2), code: true }]);
});

test("events without node have node null and keys follow the order", () => {
  const items = [ev({ type: "thought", content: "a" }), ev({ type: "answer", content: "b" })].map(toTraceItem);
  assert.deepEqual(items.map(({ key, node }) => [key, node]), [["0-thought", null], ["1-answer", null]]);
});
