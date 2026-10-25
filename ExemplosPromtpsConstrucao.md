Referência para implementação do sqlite-ops-StorageEvent

import {DatabaseSync} from 'node:sqlite'
import type {OpsStore, Incident, IncidentFilter} from './ops-store.ts'

export class SqliteOpsStore implements OpsStore {
    _db: DatabaseSync;
    constructor(path: = process.env.OPSPILOT_DB ?? "./data/opspilot.db")
    {
        this._db = new DatabaseSync(path);
        this._db.exec(`
            CREATE TABLE IF NOT EXISTS incidents (
                id TEXT PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                service_id TEXT NOT NULL,
                severity TEXT NOT NULL CHECK(severity IN ('sev1', 'sev2', 'sev3')),
                status TEXT NOT NULL CHECK(status IN ('open', 'mitigated', 'resolved')),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                resolved_at DATETIME,
                summary TEXT
            );
        ` // +services, alerts, runbooks e o seed idempotente da Mercadinho
    );
}

listIncidents(filter: IncidentFilter): Incident[] {
    const where = filter === "all" ? "" : `WHERE status = ?`;
    const stmt = this._db.prepare(`SELECT incidents ${where} ORDER BY created_at`);
    return (filter === "all" ? stmt.all() : stmt.all(filter)) as Incident[];
}

//listAlerts(), openIncidents(), resolveIncident(), getRunbbook(): mesmo padrão - preparade statement + retorno tipado
}


///////////////////////

ajuste o sqlite-ops-store.ts a tabela services deve conter os campos (name TEXT PRIMARY KEY, tier TEXT NOT NULL CHECK (tier IN ('critical', 'high','standard')))

/speckit.specify Tool de status de provedores externos:
- Tool check_provider_status em src/agents/tools.ts: consulta a statuspage pública do provedor via API statuspage.io (sem chave):
gihub -> https://www.githubstatus.com/api/v2/status.json    
cloudflare -> https://www.cloudflarestatus.com/api/v2/status.json
Parâmetro provider (enum: github, | cloudflare, default "github", .describe explicando).
Descrição orientada a quando usar: suspeita de problema externo, "é o nosso ou do provedor?", dependência fora do ar.
- Resiliência: timeout de 5s via AbortSignal.timeout; falha de rede ou 5xx, UMA nova tentativa; resposta validada com zod
({status: {indicador, description}}); qualquer falha final retorna string de erro legível como resultado da tool (erro é observação - nunca lançar exceção para fora da tool).
- Retorno compacto (indicador + descrição, uma linha), para não inflar o contexto.
- Teste: a função de fetch é injetável; testes cobrem sucesso, timeout, e resposta inválida sem uso de rede (fake fetch)

//////////////////////////////////
Referencia para implementação do retorno de status da aplicação

const statusSchema = z.object({
    status: z.object({indicator: z.string(), description: z.string() }),
});

const STATUS_URL = {
    github: 'https://githubstatus.com/api/v2/status.json',
    claudeflare: 'https://www.claudeflarestatus.com/api/v2/status.json',
} as const;

async function fetchProviderStatus(provider: keyof typeof, doFetch = fetch): Promise<string>{
    for(let attempt = 1; attempt <= 2; attempt++){
        try{
            const response = await doFetch(STATUS_URL[provider],
            {signal: AbortSignal.timeout(5000)});
            if(response.status >= 500) throw new Error(`upstream ${response.status}`)
            if(!response.ok) return `status page de ${provider} respondeu HTTP ${response.status}`
            const {status} = statusSchema.parse(await response.json());
            return `${provider} está ${status.indicator} - ${status.description}`
        }catch(error){
            if(attempt===2) return `não consegui consultar o status de ${provider}(${(error as Error).message}). Responda com base nos alertas internos e avise o plantonista da limitação`
        }
    }
    return "unreachable";
    }

// teste pelo curl
curl -s localhost:3000/chat -X POST \
-H 'Content-Type: application/json' \
-d '{"message":"o pagamento está falhando - é problema nosso ou do provedor? se for nosso, abra um incidente sev1","strategy":"react"}' | jq -r '.answer'


//////////////////////////////
exemplo mcp

import {MCPServer} from '@modelcontextprotocol/sdk/server/mcp.js'
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js'
import {z} from 'zod'
import {SqliteOpsStore} from '../store/sqlite-ops-store.ts'

const store = new SqliteOpsStore();
const server = new McpServer({
    name: 'opspilot',
    version: '1.0.0'
});

server.registerTool("open_incident",{
    description: "Abre um novo incidente no OpsPilot. Use quando o usuário relatar um problema em produção ou pedir para registrar/abrir um incidente.",
    inputSchema: {
        title: z.string().min(1).describe("Título curto do incidente"),
        service_id: z.string().describe("serviço afetado (ex: checkout, payments)"),
        severity: z.enum(['low','medium','high','critical']).describe("severidade do incidente"),
    },
}, 
async ({ title, service, severity}) => ({
    content: [{type: "text", text: JSON.stringify(store.openIncident(title, service, severity))}]
    })
)

//list_alerts e resolve_incident seguem o mesmo padrão
await server.connect(new StdioServerTransport());
console.error("opspilot MCP server: pronto (stdio)");//stderr, nunca stdout

/// referencia memory
referencia do que o agente deve montar
export async function runChat(input: ChatInput){
    const conversationid = input.conversationid ?? conversations.create();
    //buscando as ultimas 12 mensagens do historico da conversa
    const history = conversations.lastMessages(conversationid, 12);

    conversations.append(conversationid, "user", input.message);
    const result = await strategy.run({message: input.message, history});
    conversations.append(conversationid, "assistant", result.answer)

    return {conversationid, ...result, metrics:{...result.metrics, historyMessages: history.length}};
}
//
CID=$(curl -s localhost:3000/chat -X POST -H 'content-type: application/json' -d '{"message":"me chame de Thiago e abra um low no auth"}' | jq -r .conversationId)
echo "CID=$CID"
curl -s localhost:3000/chat -X POST -H 'content-type: application/json' -d '{"message":"qual o meu nome?","conversationId":"5a64b19e-90d3-417a-9e25-532f16b89bea"} | jq -r .answer'

//////////////////////
referencia para o recall
async function recall(userId: string, query: string, k =3):Promise<Memory[]>{
    const q = await embed(query)
    return this._all(userId).map(mapedUser => ({...mapedUser, score: dot(q, mappedUser.embedding)})).sort((a,b)=>b.score - a.score).slice(0,k).filter(mappedUser.score>0.3)//relevancia minima
}

/speckit.specify
Refletor de aprendizado: após cada resposta, um withStructuredOutput({
    hasLearning, fact}) lê a ultima mensagem do usuário e destila fatos duraveis (nunca pedido pontual, nunca segredo) -> memories.remeber assíncrono; tool forget_preference

//
curl -s localhost:3000/chat -X POST -H 'content-type: application/json' -d '{"message":"liste os incidentes abertos com severidade de cada um","userId":"u-42"}' | jq -r .answer

curl -s localhost:3000/chat -X POST -H 'content-type: application/json' -d '{"userId": "u-42", "fact":"prefere os alertas criticos primeiro"}' | jq -r .answer

curl -s localhost:3000/chat -X POST -H 'content-type: application/json' -d '{"message":"organiza meu plantão", "userId":"u-42"}' | jq '{answer, r: metrics.memoriesRecall/ed}'

/////// melhoria contexto
/speckit-specify Instrumente a medição de contexto: src/context/tokens.ts com estimateTokens (chars/4) e o usage real do LangChain; métricas do /chat com promptTokens real e contextBreakdown estimado por fontes; conversa-longa.sh imprime o promptTokens por turno. com testes

//// teste apos melhora de contexto
curl -s localhost:3000/chat -X POST -H 'content-type: application/json' -d '{"message":"como está o plantão?","userId":"u-42"}' | jq '.metrics | {promptTokens, contextBreakdown}'

///// sumarizar historico
/speckit.specify Sumarização de histórico (prunning): tabela conversation_summaries; o que sai das 8 mensagens recentes vira resumo de ~151 tokens preservando decisões, fatos e pendencias. MESCLADO ao resumo anterior e persistido - refeito só quando 8 novas saem da janela, nunca a cada request. Resumo entra no contexto; evento "summarize. com teste fake

/speckit.plan
/speckit.task


/speckit.implement
const SUMMARIZE_PROMPT = `Comprima o trecho de conversa a seguir em no máximo 150 tokens, preservando obrigatoriamente: decições tomadas, fatos estabelecidos (nomes, datas, prazos, preferências), incidentes abertos/resolvidos e pendências abertas. Descarte cumprimentos e conversa social. Se houver um resumo anterior, incorpore-o`
Responda  só o resumo, em tópicos telegráficos`

///  teste depois
curl -s localhost:3000/chat -X POST -H 'content-type: application/json' -d '{"message":"o que decidimos sobre os deploys?","conversationId":"'$CID'"}' | jq -r'{answer, historyMessages: .metrics.historyMessages, summarize:[.trace[]? select(.type==="summarize")], error}'

//////
speckit.specify ContextBuilder com orçamento por seção:
src/context/context-builder.ts monta o prompt de TODAS as estratégias com teto por seção via env CONTEXT_BUDGET_*: system e mensagem intocáveis, resumo 200, janela 1200 (corta as mais antigas), memórias 300 (corta menor score). Teste: tetos baixos cortam na ordem certa.

/speckit.plan
/speckit.tasks
/speckit.implement

export funciont buildContext(input: BuildInput): BuildContext{
    const sections = [
        section("system", SYSTEM_PROMPT, {budget: B.system, cut: "never"}),
        section("summary", conversations.summaryOf(input.conversationId),{budget: B.summary, cut: "never"}),
        section("history", conversations.lastMessages(input.conversationId, 8), {budget: B.history, cut:"oldest-first"}),
        section("memories", memories.recall(input.userId, input.message, 3), {budget: B.memories, cut: "lowest-score-first"}),
    ]
    const fitted = sections.map(fitToBudget) //aplica teto e regra de corte por seção
    return assemble(fitted, input.messge) //junta tudo num único prompt
}

///////////
curl -s localhost:3000/chat -X POST -H 'content-type: application/json' -d '{"message":"organiza meu plantão gostaria de ver os incidentes abertos status firing em primeiro e os resolved por ultimo","userId":"u-plantao"}' | jq '{answer, r: .metrics.memoriesRecalled}'

pegar o CID = ???

curl -s localhost:3000/chat -X POST -H 'content-type: application/json' -d '{"message":"como está meu plantão?","userId":"u-plantao", "conversationId":"'$CID'"}' | jq '.metrics.contextBreakdown'

///////////////////////
/speckit.specify Grafo unificado:
- production-graph.ts: nós contexto, roteador, as 3 estratégias como nós e resposta.
- roteador: withStructuredOutput (route, reason); tabela no promp; evento "route" e campo node em todo evento de trace.
- /chat: strategy opcional (se vier, é override no trace)

/speckit.plan
/speckit.tasks

/speckit.implement 

src/graph/production-Graph.ts
const graph = new StateGraph(GraphState)
.addNode("context", contextNode)
.addNode("roteador", routerNode)
.addNode("react", reactNode)
.addNode("planExecute", planExecuteNode)
.addNode("reflect", reflectNode)
.addNode("resposta", answerNode)
.addNode("START", "contexto")
.addConditionalEdges("roteador", (s)=> s.route, {
    "react": "react",
    "planExecute": "planExecute",
    "reflect": "reflect",
})
.addEdge("react", "resposta")
.addEdge("planExecute", "resposta")
.addEdge("reflect", "resposta")
.addEgde("resposta", "END")
.compile()

//parte schema
const routeSchema = z.object({
    route: z.enum(["react", "planExecute", "reflect"]),
    reason: z.string().describe("uma frase justificando a escolha"),
})

async function routerNode(state: typeof GraphState.State){
    const verfict = await createModel().withStructuredOutput(routeSchema).invoke([
        ["system", SYSTEM_PROMPT],
        ["user", state.input],
    ])
    trace.push(
        {
            node: "roteador",
            type: "route",
            route: verdict.route,
            reason: verdict.reason
        }
    )
    return {route: verdict.route}
}

//
curl -s localhost:3000/chat -H 'content-type: application/json' -d '{"message":"monte o plano de resposta ao incidente do checkout, em ordem","userId":"u-42"}' | jq '.metrics|{route,routeReason}'

//speckit.specify Resiliencia de modelo:
- .env: OPENROUTER_MODEL_FALLBACK
- fábrica models.ts: withRetry no primário; withFallbacks([reserva])
- Trace: evento "fallback"; metrics.modelUsed.
- Caso nada funcione, 503
/////
...continuar video 14:55 fazendo export function

export function createModel(){
    const primary = baseModel(process.env.OPENROUTER_MODEL!).withRetry({stopAfterAttempt: 2})
    const backup = baseModel(process.env.OPENROUTER_MODEL_FALLBACK!).withRetry({stopAfterAttempt: 2})
    return primary.withFallback(backup)
}

///////////// observabilidade
async function asnwerNode(state: typeof GraphState.State){
    //grava historico, dispara reflector

    request.save({
        id: state.requestId,
        userId: state:userId,
        route: state.route,
        modelUsed: state.result.metrics.modelUsed,
        promptTokens: state.result.metrics.promptTokens,
        latencyMs: state.result.metrics.latencyMS,
        status: "ok"
    })

    state.result.trace.forEach((e, seq) => traceEvent.save({
        requestid: state.requestId,
        seq,
        node: e.node,
        type: e.type,
        payload: e,
    }))
    log.info({
        requestId: state.requestId, 
        node: "resposta",
        type: "done",
        route: state.route,
        tokens: state.result.metrics.promptTokens
    })
    return state
}

// testes de pois implementacao
RID=$(curl -s localhost:3000/chat -X POST -H 'content-type: application/json' -d '{"message":"resolva o incidente mais antigo","userId":"U-42"}' |jq -r .requestId)

curl -s "localhost:3000/requests/$RID"|jq

...em powershell
$body = @{ message = "resolva o incidente mais antigo"; userId = "U-42" } | ConvertTo-Json

$RID = (Invoke-RestMethod -Uri "http://localhost:3000/chat" -Method Post -ContentType "application/json" -Body $body).requestId

Invoke-RestMethod -Uri "http://localhost:3000/requests/$RID" | ConvertTo-Json -Depth 10

/// despois de criar since
curl -s 'localhost:3000/stats?since=24h' -H 'content-type: application/json' |jq .

//// criacao da interface design specify
Crie .github/instrucstions/design.instructions.md (crie um similar para o claude) com applyTo: "web/**': hierarquia, espaçamento em escala, estados vazios e de erro, dark mode, acessibilidade

/speckit-specify War rrom web/ (Vite+react+TS) com as instructions de design: chat -> /chat, com "ver raciocínio" abrindo o trace tipado. 202 vira cartão aprovar/negar; engrenagem com URL da API; base /opspilot/; CORS

...depois de plan, task e implement
abrir na interface web http://localhost:5173/opspilot/
"Abra um incidente de severidade medium para o checkout"
depois
"me de um resumo do plantão até esse momento, minha preferência é que os alertas/incidentes criticos, sejam sempre listados primeiro, ou seja, sempre listar por prioridade"
////
Crie .github/workflows/deploy.yml para publicar a pasta web/ no Github Pages: dispara um push na main; job build com node 22, mpm ci e npm run build dentro de web/, e actions/upload-pages-artifact com path web/dist; job deploy com actions/deploy-pages e environment github-pages; permissions contents:read, pages:write, id-token:write.
Confirme que web/vite.config.ts tem base: opspilot/

...faltando o comando anterior, subir para o git e testar o pages (agente)

usar cloudflare para abrir um tunel do web que está no git para o localhost