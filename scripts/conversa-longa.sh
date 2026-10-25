#!/usr/bin/env bash
# Conversa longa contra o /chat do OpsPilot: imprime o promptTokens real de cada turno
# e a estimativa de contexto por fonte (chars/4). Requer o servidor rodando (npm run dev).
#
# Variáveis: OPSPILOT_URL (padrão http://localhost:3000), TURNS (padrão 10), STRATEGY (padrão react).
set -euo pipefail

OPSPILOT_URL="${OPSPILOT_URL:-http://localhost:3000}"
TURNS="${TURNS:-10}"
STRATEGY="${STRATEGY:-react}"

if [[ ! "$TURNS" =~ ^[1-9][0-9]*$ ]]; then
  echo "Uso: TURNS=<inteiro positivo> OPSPILOT_URL=<url> STRATEGY=<react|plan-and-execute> bash scripts/conversa-longa.sh" >&2
  exit 2
fi

QUESTIONS=(
  "Quais alertas estão disparando agora?"
  "Algum desses alertas é crítico?"
  "Quais incidentes estão abertos no momento?"
  "Existe runbook para latência alta na API?"
  "Qual é o status atual dos provedores externos?"
  "Resuma o que vimos até aqui sobre os alertas."
  "Qual serviço parece mais afetado?"
  "Que passos do runbook você recomenda primeiro?"
  "Há relação entre os incidentes abertos e os alertas?"
  "Resuma a conversa inteira em três tópicos."
)

build_body() {
  node -e '
    const [message, strategy, conversationId] = process.argv.slice(1);
    const body = { message, strategy };
    if (conversationId) body.conversationId = conversationId;
    process.stdout.write(JSON.stringify(body));
  ' "$1" "$STRATEGY" "${2:-}"
}

# Lê a resposta do /chat no stdin e imprime: conversationId<TAB>linha formatada.
format_turn() {
  node -e '
    const turn = Number(process.argv[1]);
    let raw = "";
    process.stdin.on("data", (chunk) => { raw += chunk; });
    process.stdin.on("end", () => {
      let payload;
      try { payload = JSON.parse(raw); } catch { console.error("Resposta não é JSON: " + raw); process.exit(1); }
      const metrics = payload && payload.metrics;
      const breakdown = metrics && metrics.contextBreakdown;
      if (!payload.conversationId || !metrics || !breakdown || !("promptTokens" in metrics)) {
        console.error("Resposta sem conversationId/metrics esperados: " + raw);
        process.exit(1);
      }
      const prompt = metrics.promptTokens === null ? "indisponível" : String(metrics.promptTokens);
      const line = `turno ${String(turn).padStart(2)}  promptTokens=${prompt.padStart(5)}  ` +
        `estimado(history=${breakdown.history} memory=${breakdown.memory} message=${breakdown.message} total=${breakdown.total})`;
      process.stdout.write(`${payload.conversationId}\t${line}`);
    });
  ' "$1"
}

echo "OpsPilot conversa longa: url=${OPSPILOT_URL} strategy=${STRATEGY} turnos=${TURNS}"

conversation_id=""
for ((turn = 1; turn <= TURNS; turn++)); do
  question="${QUESTIONS[$(( (turn - 1) % ${#QUESTIONS[@]} ))]}"
  body="$(build_body "$question" "$conversation_id")"
  if ! response="$(curl -sS --fail-with-body -X POST \
    -H "Content-Type: application/json" \
    --data-binary "$body" \
    "${OPSPILOT_URL}/chat" 2>&1)"; then
    echo "Falha no turno ${turn}: ${response}" >&2
    exit 1
  fi
  result="$(printf '%s' "$response" | format_turn "$turn")"
  conversation_id="${result%%$'\t'*}"
  echo "${result#*$'\t'}"
done
