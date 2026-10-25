# Research: War Room Web

Context7 was unavailable (invalid API key); library behaviour below was checked in the
installed sources (`node_modules/@langchain/langgraph@1.4.18`) and `npm view` (vite 8.3.5,
react 19.3.1, @vitejs/plugin-react 6.1.2).

## R1 — How the turn pauses before `resolve_incident`

**Decision**: Tool-level gate. `/chat` runs the graph inside `runWithApprovalPolicy(...)`
(`AsyncLocalStorage`). When the policy is active, `resolve_incident` validates its arguments and
throws `ApprovalRequiredError { tool, args, description }` instead of calling `OpsService`.
- ReAct: `createReactAgent({ tools: new ApprovalAwareToolNode(tools) })`. The subclass overrides
  the protected `runTool` with `handleToolErrors: false`: it rethrows `ApprovalRequiredError` and
  returns the same error `ToolMessage` the stock node returns for any other error
  (`Error: <message>\n Please fix your mistakes.`), so normal behaviour is unchanged.
- Plan-and-execute: its step loop already catches tool errors into observations; it rethrows
  `ApprovalRequiredError` first.
- Both attach the trace produced so far (`error.trace`) before rethrowing.
- Production graph: `strategyNode` rethrows `ApprovalRequiredError` without the ReAct strategy
  fallback, after prefixing the router/context trace and tagging nodes.

**Rationale**: Smallest change that guarantees the tool body never runs without approval, keeps
CLI/MCP unchanged (no policy there), and works for every strategy, including reflection (which
wraps them).

**Alternatives considered**:
- LangGraph `interrupt()` + checkpointer + `Command({ resume })`: the strategies run their own
  agents inside a production-graph node, so resuming would need checkpointers on nested graphs,
  persisted thread state and re-entry into the strategy; far larger and harder to test.
- `handleToolErrors: false` on the stock `ToolNode`: any ordinary tool error would abort the
  whole turn.
- Tool returns a "waiting for approval" string: the model keeps going, may call other tools or
  answer as if resolved.

## R2 — What happens after the decision

**Decision**: Deterministic finish, no model call.
- Approve: run `OpsService.resolveIncident(id)` once (injectable executor), then answer
  `Incidente <id> resolvido após aprovação do operador.`; trace = `approval(approved)` +
  `action` + `observation` (tool result) + `answer`.
- Deny: nothing runs; answer `Resolução do incidente <id> negada pelo operador; nada foi
  alterado.`; trace = `approval(denied)` + `answer`.
- If the approved execution fails (e.g. the incident no longer exists): the approval stays
  `approved`, the observation records the error, and the answer says the resolution failed;
  HTTP 200, because the decision itself was accepted.
- The user message and the "awaiting approval" assistant note are appended to the conversation
  at 202 time; the final answer is appended at decision time, so history stays coherent.

**Rationale**: Re-running the model after approval could request the tool again or contradict
the decision; a deterministic answer is testable and exact.

**Alternatives considered**: resume the strategy with the tool result (needs R1's rejected
checkpointing); new LLM turn with a synthetic message (extra cost, non-deterministic).

## R3 — Storing pending approvals

**Decision**: SQLite table `approvals` in `OPSPILOT_DB`, `expires_at = created_at + 15 min`.
Claim with one statement: `UPDATE approvals SET status=?, decided_at=? WHERE id=? AND
status='pending' AND expires_at > ?` → `changes === 1` wins; else read the row to answer 404
(unknown) or 409 (decided/expired). Expiry is computed on read (`pending` + past `expires_at`
→ reported as `expired`); no background job.

**Rationale**: Atomic first-decision-wins (two operators), survives the web page reloading,
same storage pattern as `requests`. Surviving a restart is allowed by the spec (it only says it
is not required).

**Alternatives considered**: in-memory `Map` (lost on restart, but also not shared if more than
one process ever runs; and no audit).

## R4 — Request records for 202 and decisions

**Decision**: The 202 turn is recorded like other requests with `status: 202`,
`errorCategory: null` and its metrics. The refine on `requestRecordSchema` becomes
"2xx ⇔ errorCategory null" and "2xx ⇔ metrics non-null". The decision request gets its own
`requestId` (middleware also mounted on `/approvals`) and record (`llmCalls: 0`, `modelUsed`
copied from the paused turn). The `approval` trace event links both via `approvalId` and
`originRequestId`.

## R5 — CORS

**Decision**: Own middleware in `src/http/cors.ts`: pure `corsHeaders(origin, method, policy)`
→ headers or null; middleware applies them and ends `OPTIONS` preflight with 204.
`OPSPILOT_CORS_ORIGINS` = comma-separated exact origins (Zod: each an `http(s)://host[:port]`
origin, no path); default `http://localhost:5173`. Headers: `Access-Control-Allow-Origin:
<origin>`, `Vary: Origin`, `Access-Control-Allow-Methods: GET, POST, OPTIONS`,
`Access-Control-Allow-Headers: Content-Type`, `Access-Control-Expose-Headers: X-Request-Id`,
`Access-Control-Max-Age: 600`. No credentials. `*` in the variable is rejected at startup
(`ConfigurationError`).

**Alternatives considered**: `cors` package (one more dependency for ~30 lines; the pure
function is easier to test exhaustively).

## R6 — Web stack and base path

**Decision**: Vite 8, `@vitejs/plugin-react` 6, React 19, TS strict with
`"jsx": "react-jsx"`, `"lib": ["ES2022", "DOM"]`. `vite.config.ts`: `base: "/opspilot/"`,
dev server `5173` (`strictPort`). No router (single page); assets resolve under `/opspilot/`.
`npm run dev` in dev serves at `http://localhost:5173/opspilot/`.

**Alternatives considered**: Next.js (server runtime not needed), React Router (one screen).

## R7 — Tests without leaving `node:test`

**Decision**: `web` tests run `node --import tsx --import global-jsdom/register --test
"tests/**/*.test.ts*"`. Pure modules carry most logic. Component tests use
`@testing-library/react` on jsdom and `axe-core` (`axe.run(container)`), failing on `serious`
or `critical`. Colour contrast (which axe cannot compute in jsdom) is tested on the token
palette by `lib/contrast.ts`: every text/background pair ≥ 4.5:1, UI/border pairs ≥ 3:1, in
both themes.

**Alternatives considered**: Vitest + vitest-axe (violates constitution IV), Playwright
(heavier; can be added later for SC-006 end-to-end).

## R8 — API URL and conversation identity

**Decision**: Settings stored under `localStorage["opspilot.apiUrl"]` (try/catch; default
`http://localhost:3000`). Validation: `z.url()` with protocol `http:`/`https:`, no
credentials, trailing slash removed. "Testar conexão" calls `GET /stats?since=1m` (cheap,
read-only, already exists) and classifies the failure: `TypeError` from `fetch` →
"não foi possível conectar (rede ou CORS)", non-2xx → "resposta inesperada (HTTP n)". The
`conversationId` lives in React state only and is cleared when the URL changes; a 404
`Unknown conversation` starts a new conversation with a notice.

## R9 — Rendering the trace

**Decision**: `trace-view.ts` maps each event to `{ kind, label, icon, node, content,
details }`:

| type | label (pt-BR) | details |
|------|---------------|---------|
| route | Rota | route, source, reason |
| thought | Pensamento | — |
| action | Ação | tool, args (pretty JSON) |
| observation | Observação | — |
| plan | Plano | — |
| critique | Crítica | — |
| summarize | Resumo do histórico | message counts |
| fallback | Modelo reserva | primary → reserve, reason |
| approval | Aprovação | decision, tool, target |
| answer | Resposta | — |
| (unknown) | Etapa | raw JSON |

The web schema for events is a lenient union: known kinds strict, plus a catch-all
`{ type: string }` passthrough, so new kinds never break the page (FR-008). Text is rendered in
`<pre>`/text nodes only.
