# OpsPilot

OpsPilot é um copiloto de plantão para triagem de alertas. A arena compara as
estratégias ReAct e Plan-and-Execute usando OpenRouter; ferramentas simuladas
operam sobre um store em memória carregado de `data/ops-store.json`.

## Requisitos

- Node.js 22 LTS.
- Copie `.env.example` para `.env` e configure as credenciais localmente. Nunca
  versione ou imprima secrets.
- `npm run seed` cria/atualiza o baseline JSON sem precisar de MySQL.

## Comandos

- `npm run dev`
- `npm run arena -- --help`
- `npm run arena -- --strategies react,plan-and-execute --max-iterations 4 "Como está o plantão?"`
- `npm run bench`
- `npm run bench -- --scenario C2 --no-replanner`
- `npm run seed`
- `npm run conversa-longa` (com `npm run dev` rodando; `TURNS=12 OPSPILOT_URL=... STRATEGY=...`)
- `npm test`
- `npm run typecheck`

O benchmark executa C1, C2 e C3 com ReAct e Plan-and-Execute e imprime uma
tabela consolidada de acerto, chamadas de LLM e latência. `--scenario C1|C2|C3`
seleciona um cenário; `--no-replanner` executa o plano inicial do
Plan-and-Execute sem revisá-lo após cada ação. Cada execução usa um store
isolado em memória e a pontuação é verificada pelo estado final do store.

## Medição de contexto

Cada resposta do `POST /chat` traz em `metrics`:

- `promptTokens`: tokens de entrada reais informados pelo provedor, somados em
  todas as chamadas ao modelo do turno; `null` quando alguma chamada não informou
  uso.
- `contextBreakdown`: estimativa (`method: "chars/4"`) dos tokens de `history`,
  `memory`, `summary` e `message` efetivamente enviados, mais o `total`. Não inclui
  instruções de sistema nem definições de ferramentas, por isso fica abaixo de
  `promptTokens`.

`npm run conversa-longa` envia vários turnos na mesma conversa e imprime o
`promptTokens` de cada um. Contrato completo em
[`specs/010-context-token-metrics/contracts/chat-metrics.md`](specs/010-context-token-metrics/contracts/chat-metrics.md).

## Sumarização de histórico

As 8 mensagens mais recentes vão literais no contexto. Quando 8 mensagens já fora
dessa janela ainda não estão resumidas, elas são condensadas em um resumo de ~151
tokens (decisões, fatos, incidentes e pendências), mesclado ao resumo anterior e
persistido na tabela `conversation_summaries`. O resumo só é refeito a cada novo
lote de 8 mensagens (turnos 9, 13, 17… de uma conversa), nunca a cada request, e
entra no contexto antes do histórico. O turno que resume traz um evento
`summarize` no início do `trace` (`status: "ok"` ou `"failed"`); uma falha mantém o
resumo anterior e não derruba a resposta. Contrato em
[`specs/011-history-summarization/contracts/chat-summarization.md`](specs/011-history-summarization/contracts/chat-summarization.md).

## Orçamento de contexto

`src/context/context-builder.ts` monta o prompt de todas as estratégias (chat, arena
e bench) na ordem: instrução de sistema do OpsPilot → resumo → histórico → memórias
→ mensagem atual. Cada seção tem um teto em tokens estimados (chars/4), configurável
por variável de ambiente:

| Variável | Padrão | Regra |
|----------|--------|-------|
| `CONTEXT_BUDGET_SYSTEM` | 400 | nunca corta; só sinaliza `overBudget` |
| `CONTEXT_BUDGET_SUMMARY` | 200 | nunca corta; só sinaliza `overBudget` |
| `CONTEXT_BUDGET_HISTORY` | 1200 | corta mensagens inteiras, das mais antigas |
| `CONTEXT_BUDGET_MEMORIES` | 300 | corta fatos inteiros, do menor score |

A mensagem atual nunca é cortada. Um valor inválido impede o servidor de subir. Cada
resposta do `/chat` traz `metrics.contextBudget` (teto, tokens mantidos, itens e
tokens descartados por seção). Contrato em
[`specs/012-context-budget-builder/contracts/context-budget.md`](specs/012-context-budget-builder/contracts/context-budget.md).

## Grafo de produção

Cada turno do `/chat` passa por um grafo LangGraph (`src/graph/production-graph.ts`):
`context` (histórico, resumo, memórias e orçamento de contexto) → `router` →
`react` | `plan-and-execute` | `reflection` (reflexão sobre a ReAct) → `response`.

O roteador usa saída estruturada `{ route, reason }` e escolhe pela tabela do prompt:
`react` para perguntas diretas com poucas consultas, `plan-and-execute` para tarefas
com várias ações e `reflection` para respostas de julgamento ou alto impacto. O trace
traz um evento `route` (`source`: `router`, `override` ou `fallback`) e todo evento
tem o campo `node` com a etapa que o gerou. `strategy` no corpo do `/chat` agora é
opcional: quando vem, é um override e o roteador não é consultado (`reflect: true` e
`reflect:<estratégia>` viram `reflection`). Se o roteador falhar, o turno segue com
`react` e o evento `route` mostra `fallback`. Se a estratégia escolhida
(`plan-and-execute` ou `reflection`) falhar, o turno é refeito com `react` e um segundo
evento `route` com `source: "fallback"` registra o motivo. A chamada do roteador conta em
`llmCalls`/`promptTokens`. Contrato em
[`specs/013-unified-production-graph/contracts/chat-routing.md`](specs/013-unified-production-graph/contracts/chat-routing.md).

## Resiliência de modelo

`createModel()` (`src/llm/model.ts`) aplica, em cada chamada, retry no modelo principal
(`OPENROUTER_MODEL`) e troca para o modelo reserva (`OPENROUTER_MODEL_FALLBACK`, opcional,
mesmo provedor e chave): `withRetry({ stopAfterAttempt: 2 })` em cada modelo e
`withFallbacks([reserva])`. Erros 400/401/403/404/422 não são repetidos (vão direto para a
reserva); limite de chamadas, configuração e cancelamento nunca trocam de modelo. Reserva
vazia ou igual ao principal = sem reserva (o servidor informa na inicialização).

Cada chamada servida pela reserva gera um evento `fallback` no trace (`primaryModel`,
`reserveModel`, `reason` sem secrets, `node` da etapa) e `metrics.modelUsed` indica o modelo
do turno (a reserva, se alguma chamada a usou). Se nenhum modelo responder à estratégia que
gera a resposta, o `/chat` devolve **503** `{"error":"Language models are unavailable; try again later."}`
e nada é gravado; falhas só no roteador ou na sumarização mantêm os fallbacks existentes.
Arena, bench e MCP usam a mesma fábrica. Contrato em
[`specs/014-model-resilience/contracts/chat-model-resilience.md`](specs/014-model-resilience/contracts/chat-model-resilience.md).

## Rastreamento e logs

Toda resposta do `/chat` (inclusive erros) traz o header `X-Request-Id` e o campo `requestId`
no corpo; um `X-Request-Id` enviado pelo cliente é ignorado. Antes de responder, o servidor
grava no banco do `OPSPILOT_DB` uma linha em `requests` (status, categoria do erro, conversa,
usuário, rota pedida e rota que respondeu, chamadas ao modelo, latência, tokens, modelo usado)
e uma linha por evento em `trace_events` (`seq`, `type`, `node` e o evento já sem secrets).
`GET /requests/:id` devolve o registro e o trace na ordem original (400 para id inválido, 404
para id desconhecido). Turnos que falham guardam o trace das etapas que terminaram.
Um turno que pausa para aprovação grava status `202`, sem categoria de erro e com métricas, e o
trace termina num evento `approval` (`decision: "pending"`). A decisão vira outro request (`200`,
sem rota, `llmCalls: 0`) cujo trace começa com `approval` (`approved` ou `denied`).

Os logs saem em **stderr** (stdout fica livre para o protocolo do MCP), uma linha JSON por
evento, só com metadados: `request_started`, `trace_event`, `request_finished`,
`persistence_failed`, `router_fallback`, `strategy_fallback`, `model_fallback`,
`summarization_failed` e `learning_reflection_failed`. Mensagens, respostas, motivos e
argumentos de ferramentas nunca vão para o log. Contratos em
[`specs/015-request-trace-logs/contracts/`](specs/015-request-trace-logs/contracts/).

Para cenários de validação e resultados esperados, consulte
[`specs/001-reasoning-core/quickstart.md`](specs/001-reasoning-core/quickstart.md).

## Estatísticas (`GET /stats`)

Agrega os requests gravados em `requests` numa janela de tempo:

```bash
curl -s "localhost:3000/stats?since=24h" | jq
```

- Conta como erro só status `>= 400`; um `202` (aguardando aprovação) não é erro.
- `since`: `30m`, `24h`, `7d` (padrão `24h`, máximo `365d`); formato inválido → `400`.
- Resposta: `since`, `from`, `to`, `total`, `errors`, `errorRate`, `promptTokens`, `costUsd`,
  `latencyMs.p50`/`p95` (nearest-rank, sobre a duração do request), `requestsWithoutTokens`,
  `unpricedModels`, e os mesmos totais em `byRoute` (sem rota → `none`) e `byModel`
  (requests com erro não têm métricas → `unknown`).
- Custo: modelos `:free` e `openrouter/free` custam `0`. Para os demais, defina
  `OPSPILOT_MODEL_PRICES` com USD por 1M de tokens de prompt, ex.
  `{"openai/gpt-4o-mini":0.15}`. Modelos sem preço entram em `unpricedModels` e não somam custo
  (o `costUsd` do grupo fica `null` se nenhum request do grupo tiver preço).
- Só tokens de prompt são gravados, então o custo é uma estimativa do prompt (sem tokens de saída).

## Aprovação de ações no `/chat`

No HTTP, `resolve_incident` não roda direto: o `/chat` para antes e responde **`202`** com
`status: "pending_approval"`, a proposta (`approval.id`, `tool`, `target`, `args`, `expiresAt`) e
o trace até a pausa. Consultas e abrir incidente continuam automáticos. CLI e MCP não mudam.

```bash
curl -s localhost:3000/approvals/<id> | jq                       # 200 / 400 / 404
curl -s -X POST localhost:3000/approvals/<id>/decision   -H 'Content-Type: application/json' -d '{"decision":"approve"}' | jq   # ou "deny"
```

- A aprovação expira em 15 minutos e só pode ser decidida uma vez (outra decisão ou expirada →
  `409` com o estado atual). Aprovar executa a resolução sem nova chamada ao modelo; negar não
  altera nada. As duas respostas trazem `answer`, `trace` e `metrics` e entram na conversa.
- Contratos em [`specs/016-war-room-web/contracts/`](specs/016-war-room-web/contracts/).

## War Room (`web/`)

Interface web do plantão (Vite + React + TypeScript): chat com o `/chat`, botão **Ver raciocínio**
com o trace tipado de cada resposta, cartão **Aprovar/Negar** para respostas `202`, engrenagem
para a URL da API e tema claro/escuro/sistema.

```bash
npm install --prefix web
npm run dev                    # API em http://localhost:3000 (outro terminal)
npm run dev --prefix web       # http://localhost:5173/opspilot/
npm test --prefix web          # testes (jsdom + axe)
npm run build --prefix web     # gera web/dist
npm run preview --prefix web   # http://localhost:4173/opspilot/
```

- A URL da API fica na engrenagem (padrão `http://localhost:3000`) e é salva neste navegador
  (`localStorage`, chave `opspilot.apiUrl`). Trocar a URL inicia uma nova conversa.
- A build usa a base `OPSPILOT_WEB_BASE` (padrão `/opspilot/`; precisa começar e terminar com
  `/`). O workflow do Pages usa `/<repositório>/`; `dev` e `preview` locais seguem em `/opspilot/`.
- **CORS:** a API só aceita origens listadas em `OPSPILOT_CORS_ORIGINS` (separadas por vírgula;
  padrão `http://localhost:5173`). Para o preview use `http://localhost:4173`; em produção, a
  origem exata da War Room (ex. `https://ops.example.com`). `*` é recusado.

### Publicação no GitHub Pages

A War Room publicada fica em <https://cyzop.github.io/opspilot/>, a partir do repositório
[`cyzop/opspilot`](https://github.com/cyzop/opspilot).

- **Ativação (uma vez, admin do repositório):** Settings → Pages → Build and deployment →
  Source: **GitHub Actions**.
- **Gatilhos** do workflow [`.github/workflows/opspilot-web-pages.yml`](.github/workflows/opspilot-web-pages.yml)
  ("OpsPilot War Room — Pages"):
  - push na `main` que mude `web/**` ou o próprio workflow;
  - manual: Actions → "OpsPilot War Room — Pages" → **Run workflow**.
- **O que ele faz:** `npm ci`, typecheck, testes e build de `web/` com
  `OPSPILOT_WEB_BASE=/<repositório>/` e publica `web/dist`.
  Se qualquer passo falhar, nada é publicado e a versão anterior continua no ar. Uma publicação
  por vez: a nova espera a que está em andamento.
- **Permissões:** `contents: read` no build; `pages: write` e `id-token: write` só no deploy.
  Nenhum secret é usado.
- **Conversar com a sua API:** inclua a origem do Pages em `OPSPILOT_CORS_ORIGINS` no seu `.env`
  (só esquema e host, sem caminho, nunca `*`):
  `OPSPILOT_CORS_ORIGINS=http://localhost:5173,https://cyzop.github.io`.
  Depois, na engrenagem da War Room publicada, use a URL da API e clique em **Testar conexão**.
- **HTTPS:** o site é servido em HTTPS. `http://localhost:3000` funciona (o Chrome pode pedir
  permissão de acesso à rede local); uma API em outro host precisa de HTTPS, ou o navegador
  bloqueia a chamada.
