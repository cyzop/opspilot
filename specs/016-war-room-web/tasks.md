---

description: "Task list for feature 016 — War Room Web"
---

# Tasks: War Room Web

**Input**: Design documents from `/specs/016-war-room-web/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/http-api.md, contracts/web-ui.md, quickstart.md

**Tests**: Required — constitution IV ("Toda lógica nova deve nascer com testes usando `node:test` via `tsx`"). Write each test task before its implementation and see it fail first.

**Organization**: Tasks are grouped by user story so each story can be implemented and tested on its own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US5 from spec.md

## Path Conventions

- API: `src/`, `tests/` at the repository root (`ops-pilot/`)
- Web: `web/src/`, `web/tests/` (separate npm project)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the `web/` project and keep the root project unaffected.

- [X] T001 Create `web/package.json` (`"type": "module"`, `"private": true`) with scripts `dev` (`vite`), `build` (`tsc --noEmit && vite build`), `preview` (`vite preview`), `typecheck` (`tsc --noEmit`), `test` (`node --import tsx --import global-jsdom/register --test "tests/**/*.test.ts" "tests/**/*.test.tsx"`); dependencies `react@19`, `react-dom@19`, `zod@4`; devDependencies `vite@8`, `@vitejs/plugin-react@6`, `typescript`, `tsx`, `@types/react`, `@types/react-dom`, `jsdom`, `global-jsdom`, `@testing-library/react`, `axe-core`, `@types/node`; run `npm install --prefix web`
- [X] T002 [P] Create `web/tsconfig.json` (`strict: true`, `target`/`lib` `ES2022` + `DOM` + `DOM.Iterable`, `module: ESNext`, `moduleResolution: Bundler`, `jsx: react-jsx`, `allowImportingTsExtensions: true`, `noEmit: true`, `types: ["node"]`, include `src`, `tests`, `vite.config.ts`)
- [X] T003 [P] Create `web/vite.config.ts` with `@vitejs/plugin-react`, `base: "/opspilot/"`, `server: { port: 5173, strictPort: true }`, `preview: { port: 4173, strictPort: true }`
- [X] T004 [P] Create `web/index.html` (`<html lang="pt-BR">`, viewport meta, `<title>OpsPilot War Room</title>`, `<div id="root">`, module script `/src/main.tsx`) and `web/src/main.tsx` rendering `<App />` in `StrictMode`
- [X] T005 [P] Add `web/dist/` and `web/node_modules/` to `.gitignore` (root `node_modules`/`dist` patterns already cover them; verify with `git check-ignore`)
- [X] T006 Add a smoke test `web/tests/smoke.test.tsx` that renders `<App />` with `@testing-library/react` and finds the `h1` "War Room"; run `npm test --prefix web` and `npm run typecheck --prefix web` to prove the toolchain (test fails until T012)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Design tokens, typed API client base, page shell and CORS (without CORS the war room on :5173 cannot call the API on :3000).

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Tests

- [X] T007 [P] Write `web/tests/lib/contrast.test.ts`: `contrastRatio("#000000", "#ffffff") === 21`; for both `light` and `dark` palettes in `tokens.ts`, every pair `text|text-muted|primary-text on bg|surface|surface-raised` (and `primary-text` on `primary`) is ≥ 4.5, and `border|focus|danger|warning|success` on `bg` is ≥ 3
- [X] T008 [P] Write `tests/http/cors.test.ts` for the pure policy in `src/http/cors.ts`: `parseCorsOrigins(undefined)` → `["http://localhost:5173"]`; `"http://a.test, https://b.test:8443"` → both; `"*"`, `"http://a.test/path"`, `"ftp://x"` → `ConfigurationError`; `corsHeaders({ origin, method, requestMethod }, allowed)` returns `Access-Control-Allow-Origin: <origin>`, `Vary: Origin`, `Access-Control-Expose-Headers: X-Request-Id` for allowed origins, adds `Access-Control-Allow-Methods: GET, POST, OPTIONS`, `Access-Control-Allow-Headers: Content-Type`, `Access-Control-Max-Age: 600` on preflight, and returns `null` for a disallowed or missing origin
- [X] T009 [P] Add server tests in `tests/http/server.test.ts`: `OPTIONS /chat` with an allowed `Origin` + `Access-Control-Request-Method: POST` → `204` with the headers above; `POST /chat` from an allowed origin exposes `X-Request-Id`; `GET /stats` with `Origin: http://evil.example` has no `Access-Control-*` header; a request without `Origin` is unchanged; `createChatServer({ corsOrigins: [...] })` overrides the env default
- [X] T010 [P] Write `web/tests/lib/api-client.test.ts` with an injected fake `fetch`: 200 `/chat` body parsed into `{ kind: "answer", ... }`; JSON error body `{ error, requestId }` with 404/400/503/504 → `ApiError { kind: "http", status, message (pt-BR), requestId }`; `fetch` rejecting with `TypeError` → `{ kind: "network", message: "Não foi possível conectar à API (rede ou CORS)." }`; abort after the client timeout → `{ kind: "timeout" }`; a 200 body missing `answer` → `{ kind: "invalid_response" }`; base URL joined without double slashes

### Implementation

- [X] T011 [P] Create `web/src/lib/contrast.ts` (WCAG relative luminance + `contrastRatio(hexA, hexB)`) and `web/src/styles/tokens.ts` exporting `space` (4, 8, 12, 16, 24, 32, 48, 64), `fontSize` (12, 14, 16, 20, 24, 32), `lineHeight: 1.5`, and `palettes.light` / `palettes.dark` with keys `bg, surface, surface-raised, text, text-muted, border, primary, primary-text, danger, warning, success, focus` plus one colour per trace kind; make T007 pass
- [X] T012 Create `web/src/styles/tokens.css` (`:root` custom properties `--space-1..8`, `--font-1..6`, `--color-*` light; dark set under `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }` and under `:root[data-theme="dark"]`; `color-scheme` per theme; explicit `body` background/text; `:focus-visible` outline `2px solid var(--color-focus)`; `@media (prefers-reduced-motion: reduce)` disables animations), a test asserting the CSS values match `tokens.ts` in `web/tests/styles/tokens-css.test.ts`, and `web/src/App.tsx` shell (`header` with `h1` "War Room", `main`, `footer` slots; layout works from 320px, no horizontal scroll); make T006 pass
- [X] T013 Create `web/src/lib/api-schemas.ts` with Zod schemas for the `/chat` 200 body (`answer`, `trace`, `conversationId`, `requestId`, `metrics { llmCalls, latencyMs, promptTokens: number|null, historyMessages, modelUsed }` — extra metric keys allowed) and the error body (`{ error: string, requestId?: string, issues?: unknown }`); keep `trace` as `z.array(z.unknown())` for now (US2 narrows it)
- [X] T014 Create `web/src/lib/api-client.ts`: `createApiClient({ baseUrl, fetch, timeoutMs = 190_000 })` with `chat({ message, conversationId? })` returning `{ ok: true, kind: "answer", body } | { ok: false, error: ApiError }`; plain-language pt-BR messages per status (400 "A mensagem foi recusada pela API.", 404 conversation "A conversa não existe mais na API.", 503 "Nenhum modelo disponível no momento.", 504 "A API demorou demais para responder.", other "Erro inesperado da API (HTTP n).") and `requestId` from the body or `X-Request-Id`; make T010 pass
- [X] T015 Create `web/src/lib/settings.ts` minimal: `DEFAULT_API_URL = "http://localhost:3000"`, `loadApiUrl(storage?: Storage)` returning the stored value only if valid, wrapped in try/catch (storage may throw); US4 adds validation messages and saving
- [X] T016 Create `src/http/cors.ts` (`parseCorsOrigins(raw)` with Zod — each value an `http:`/`https:` URL whose `origin` equals the trimmed value, `*` rejected with `ConfigurationError`, default `["http://localhost:5173"]`; pure `corsHeaders(...)`; `corsMiddleware(allowed)` that sets headers and ends allowed and disallowed `OPTIONS` preflights with `204`); make T008 pass
- [X] T017 Mount `corsMiddleware` first in `createChatServer` in `src/http/server.ts` (before the request-id middleware), add `corsOrigins?: readonly string[]` to `ChatServerOptions` (default `parseCorsOrigins(process.env.OPSPILOT_CORS_ORIGINS)`), add `OPSPILOT_CORS_ORIGINS=http://localhost:5173` with a comment to `.env.example`; make T009 pass

**Checkpoint**: `npm test` / `npm run typecheck` green at the root (except the pre-existing `forget_preference` failure) and in `web/`; the shell renders in both themes.

---

## Phase 3: User Story 1 - Talk to the agent from a browser war room (Priority: P1) 🎯 MVP

**Goal**: Send messages to `/chat`, show answers in order in one conversation, with empty/loading/error states.

**Independent Test**: With the API running, open `http://localhost:5173/opspilot/`, send two related messages and see both answers in the same conversation; stop the API and see the error with retry.

### Tests for User Story 1

- [X] T018 [P] [US1] Write `web/tests/lib/chat-state.test.ts` for the reducer: `send` adds a `sending` turn and is ignored while another turn is `sending` or the message is blank after `trim()`; `answered` stores answer/trace/metrics/requestId and sets `conversationId`; `failed` keeps the message; `retry` returns the turn to `sending`; `newConversation` clears `conversationId` and turns; a failure with status 404 on a known `conversationId` clears it and sets `notice` "A conversa anterior não existe mais; uma nova foi iniciada."
- [X] T019 [P] [US1] Write `web/tests/components/chat-view.test.tsx` (Testing Library + fake client): empty state shows "Pronto para o plantão" and 3 example buttons that send their text; sending shows the skeleton and disables `Enviar`; the answer replaces the skeleton; `Enter` sends and `Shift+Enter` inserts a new line; an error shows the pt-BR message, "ID: <requestId>" and `Tentar de novo` that resends the same message; answers containing `<script>` or `<b>` render as literal text; `axe-core` reports no `serious`/`critical` violations for empty, answered and error states

### Implementation for User Story 1

- [X] T020 [US1] Create `web/src/lib/chat-state.ts` (types `Turn`, `ChatState` and the reducer actions from data-model.md: `send`, `answered`, `failed`, `retry`, `newConversation`; the approval and `apiChanged` actions come in US3/US4); make T018 pass
- [X] T021 [P] [US1] Create `web/src/components/EmptyState.tsx` (heading, one sentence, 3 example buttons: "Quais alertas estão ativos?", "Liste os incidentes abertos", "Qual o status dos provedores?")
- [X] T022 [P] [US1] Create `web/src/components/ErrorNotice.tsx` (`role="alert"`, message, optional "ID: <requestId>" in a copyable `<code>`, `Tentar de novo` button)
- [X] T023 [P] [US1] Create `web/src/components/Composer.tsx` (`<label for>` "Mensagem", `textarea`, `Enviar` primary button, `Enter` sends / `Shift+Enter` new line, disabled while busy, ≥44px targets)
- [X] T024 [US1] Create `web/src/components/Turn.tsx` (operator bubble + agent slot: skeleton when `sending`, answer text with `white-space: pre-wrap` and wrapping long words, `ErrorNotice` when `failed`) and `web/src/components/ChatView.tsx` (`role="log"`, `aria-live="polite"`, notice in `role="status"`, scrolls to the newest turn)
- [X] T025 [US1] Wire `App.tsx`: `useReducer(chatReducer)`, API client built from `loadApiUrl()`, `Nova conversa` button in the header, send/retry handlers calling `client.chat`; make T019 pass
- [X] T026 [US1] Add `web/src/styles/app.css` for layout, bubbles, skeleton (animation off under reduced motion), using only `var(--space-*)`, `var(--font-*)`, `var(--color-*)`; add a test in `web/tests/styles/app-css.test.ts` that fails on any `px` value outside the space/type scales or any literal colour in `app.css`

**Checkpoint**: US1 works end to end against the real API (quickstart step 1).

---

## Phase 4: User Story 2 - "Ver raciocínio": inspect the typed reasoning trace (Priority: P1)

**Goal**: Each answer has a toggle that opens the ordered, typed trace with metrics.

**Independent Test**: Ask something that calls a tool, open "Ver raciocínio" and see Rota → Ação (tool + args) → Observação → Resposta in response order, plus the metrics summary.

### Tests for User Story 2

- [X] T027 [P] [US2] Write `web/tests/lib/trace-view.test.ts`: each known kind maps to the label in research R9 (`route`→"Rota" with details route/source/reason, `action`→"Ação" with tool and pretty-printed args, `fallback`→"Modelo reserva" with "primary → reserve", `summarize`→"Resumo do histórico", `approval`→"Aprovação" with decision/tool/target, …); an unknown `{ type: "novo" }` maps to `kind: "unknown"`, label "Etapa", raw JSON detail; events without `node` give `node: null`; order is preserved
- [X] T028 [P] [US2] Write `web/tests/lib/api-schemas.test.ts`: a trace with every current kind parses; an unknown kind passes through; a known kind with a wrong field type (e.g. `action.tool: 1`) fails as `invalid_response`
- [X] T029 [P] [US2] Write `web/tests/components/trace.test.tsx`: toggle is closed by default with `aria-expanded="false"` and `aria-controls` pointing at the list; opening shows an `<ol>` with one item per event in order; empty trace shows "Nenhuma etapa de raciocínio registrada."; metrics show Modelo, Chamadas ao modelo, Latência (ms), Tokens de prompt ("não disponível" when null); trace content with markup renders as text; `axe-core` clean with the trace open

### Implementation for User Story 2

- [X] T030 [US2] Extend `web/src/lib/api-schemas.ts`: `traceEventSchema` = union of strict known kinds (thought, action `{tool, args}`, observation, plan, critique, answer, summarize, route `{route, reason, source}`, fallback `{primaryModel, reserveModel, reason}`, approval `{approvalId, decision, tool, target}`, all with optional `node`) or a passthrough `{ type: string }` that is not a known kind; make T028 pass
- [X] T031 [US2] Create `web/src/lib/trace-view.ts` (`toTraceItem(event, index)` → `TraceItemView`); make T027 pass
- [X] T032 [P] [US2] Create `web/src/components/TraceEventItem.tsx` (icon `aria-hidden`, label text, node badge, `<pre>` content with wrapping, `<dl>` details; colour per kind from tokens, never colour alone)
- [X] T033 [P] [US2] Create `web/src/components/MetricsSummary.tsx` (`<dl>` of the four metrics)
- [X] T034 [US2] Create `web/src/components/TraceToggle.tsx` + `web/src/components/TraceList.tsx` and render them under each answered turn in `Turn.tsx`; make T029 pass

**Checkpoint**: US1 + US2 = MVP (read-only war room with auditable answers).

---

## Phase 5: User Story 3 - Approve or deny resolving an incident (Priority: P2)

**Goal**: `/chat` pauses before `resolve_incident` with HTTP 202; the war room shows an approval card; the decision endpoint resolves once or not at all.

**Independent Test**: Open an incident, ask to resolve it → 202 + card; `Negar` leaves it open; ask again, `Aprovar` resolves it and shows the final answer; a second decision gets "Não está mais pendente".

### API tests for User Story 3

- [X] T035 [P] [US3] Extend `tests/trace/trace.test.ts`: an `approval` event `{ type: "approval", node?, content, approvalId: uuid, decision: "pending"|"approved"|"denied", tool: "resolve_incident", target }` parses; other decisions/tools fail
- [X] T036 [P] [US3] Extend `tests/store/sqlite-request-store.test.ts`: a record with `status: 202`, `errorCategory: null` and metrics is valid; `202` with an `errorCategory` or without metrics is invalid; existing 200/4xx/5xx rules unchanged; extend `tests/stats/stats.test.ts` so 202 does not count as an error
- [X] T037 [P] [US3] Write `tests/approval/approval-context.test.ts`: `approvalRequiredFor("resolve_incident")` is false outside `runWithApprovalPolicy`, true inside it, false for `open_incidente`, and the policy does not leak across concurrent async runs
- [X] T038 [P] [US3] Write `tests/approval/sqlite-approval-store.test.ts` (`:memory:`, injected clock): `create` returns `status: "pending"`, `expiresAt = createdAt + 15 min`, `decidedAt: null`; `get` with a malformed id throws `DomainValidationError`, unknown id → `undefined`, pending past `expiresAt` → `status: "expired"`; `claim` once → `{ ok: true }` with `decidedAt` and `decision_request_id`; a second claim → `{ ok: false, reason: "not_pending" }`; claim after expiry → `not_pending`; unknown → `unknown`; only `tool = 'resolve_incident'` accepted
- [X] T039 [P] [US3] Write `tests/tools/resolve-incident.test.ts` cases: outside the policy the tool resolves the incident as before; inside the policy it throws `ApprovalRequiredError` with `{ tool: "resolve_incident", args: { id }, target: id, description: "Resolver o incidente <id>" }` and the incident stays open; invalid args still fail validation first
- [X] T040 [P] [US3] Write `tests/strategies/approval-tool-node.test.ts`: `ApprovalAwareToolNode` rethrows `ApprovalRequiredError`; any other tool error becomes a `ToolMessage` with `status: "error"` and content `Error: <message>\n Please fix your mistakes.` (same as the stock `ToolNode`)
- [X] T041 [P] [US3] Extend `tests/strategies/react.test.ts` and `tests/strategies/plan-and-execute.test.ts` with fake models that call `resolve_incident` under the policy: the strategy rethrows `ApprovalRequiredError` whose `trace` holds the events so far (thought + action for `resolve_incident`), no further model call happens, and other tool errors still become observations
- [X] T042 [P] [US3] Extend `tests/graph/production-graph.test.ts`: when the routed strategy throws `ApprovalRequiredError`, the graph does not fall back to ReAct, logs no `strategy_fallback`, and rethrows with the trace prefixed by context/router events and tagged with the strategy node
- [X] T043 [P] [US3] Write `tests/approval/approval-service.test.ts` for pure functions: `pendingTraceEvent(approval, node)` → `approval(pending)` with content "Aguardando aprovação: <description>"; `decisionOutcome({ approval, decision: "approved", execution: { ok: true, result } })` → answer `Incidente <id> resolvido após aprovação do operador.` and trace `approval(approved)`, `action`, `observation`, `answer` (all `node: "response"`); execution `{ ok: false, message }` → answer says the resolution failed and the observation carries the error; `denied` → answer `Resolução do incidente <id> negada pelo operador; nada foi alterado.` and trace `approval(denied)`, `answer`
- [X] T044 [US3] Add server tests in `tests/http/server.test.ts` (fake graph strategy that calls the gated tool, injected `approvalStore: new SqliteApprovalStore(":memory:")`, injected `resolveIncident` executor spy, injected clock): `POST /chat` → `202` body matching contracts/http-api.md (`status: "pending_approval"`, approval, trace ending in `approval(pending)`, metrics), executor not called, request record stored with status 202, conversation has the user message and the "Aguardando aprovação" assistant note; `GET /approvals/:id` → 200/400/404 and `expired` after 15 min; `POST /approvals/:id/decision` approve → 200, executor called exactly once, answer and trace per T043, final message appended to the conversation, new request recorded with its own `requestId`/`X-Request-Id`; deny → executor never called; second decision → 409 with the approval; unknown → 404; bad body `{ decision: "maybe" }` → 400; after expiry → 409; a read-only question and an "open incident" request still return 200 without approval

### API implementation for User Story 3

- [X] T045 [P] [US3] Add the `approval` variant to `traceEventSchema` in `src/trace/trace.ts` (`approvalId: z.uuid()`, `decision: z.enum(["pending","approved","denied"])`, `tool: z.literal("resolve_incident")`, `target: z.string().min(1)`); make T035 pass
- [X] T046 [P] [US3] Change the refine in `src/store/request-store.ts` to "2xx ⇔ `errorCategory === null`" and "2xx ⇔ `metrics !== null`", and make `src/stats/stats.ts` count only `status >= 400` as errors; make T036 pass
- [X] T047 [P] [US3] Create `src/approval/approval-errors.ts` (`ApprovalRequiredError extends OpsPilotError` with `proposal: { tool, args, target, description }` and mutable `trace: TraceEvent[]`; `UnknownApprovalError`; `ApprovalNotPendingError`) and `src/approval/approval-context.ts` (`runWithApprovalPolicy`, `approvalRequiredFor`); make T037 pass
- [X] T048 [US3] Create `src/approval/approval-store.ts` (`approvalSchema` strict per data-model.md, `ApprovalStore` interface, `APPROVAL_TTL_MS = 15 * 60_000`) and `src/approval/sqlite-approval-store.ts` (table `approvals` exactly as in data-model.md, `PRAGMA busy_timeout = 2000`, atomic `claim` via `UPDATE … WHERE id = ? AND status = 'pending' AND expires_at > ?`); make T038 pass
- [X] T049 [US3] Gate `src/tools/resolve-incident.ts`: after schema validation, if `approvalRequiredFor("resolve_incident")` throw `ApprovalRequiredError` instead of calling the service; make T039 pass
- [X] T050 [US3] Create `src/strategies/approval-tool-node.ts` (`class ApprovalAwareToolNode extends ToolNode`, constructed with `handleToolErrors: false`, overriding protected `runTool` to rethrow `ApprovalRequiredError` and otherwise return the stock error `ToolMessage`); use it in `createReactAgent({ tools: new ApprovalAwareToolNode(tools) })` in `src/strategies/react.ts`, and in its catch attach the sanitized `callbackToolEvents` to the error's `trace` before rethrowing; make T040 pass
- [X] T051 [US3] In `src/strategies/plan-and-execute.ts` rethrow `ApprovalRequiredError` from the step `catch` (before turning errors into observations), attaching the trace so far; make T041 pass
- [X] T052 [US3] In `src/graph/production-graph.ts` `strategyNode`: on `ApprovalRequiredError` skip the ReAct fallback, set `error.trace` to the state trace + model fallbacks + the strategy's partial trace tagged with `STRATEGY_NODES[route]`, and rethrow; expose the routed strategy on the error for the request record; make T042 pass
- [X] T053 [US3] Create `src/approval/approval-service.ts` (pure `pendingTraceEvent`, `decisionOutcome`); make T043 pass
- [X] T054 [US3] In `src/http/server.ts`: add options `approvalStore?: ApprovalStore` (default `new SqliteApprovalStore()`, closed by `startChatServer`) and `resolveIncident?: (id: string) => unknown` (default `new OpsService(createOpsStore()).resolveIncident`); run `graph.run` inside `runWithApprovalPolicy`; catch `ApprovalRequiredError` → create the approval, append the user message and the "Aguardando aprovação: <description>" note to the conversation, record the request with status 202, respond `202` validated by a Zod `pendingApprovalResponseSchema`; mount the request-id middleware on `/approvals` too; add `GET /approvals/:id` and `POST /approvals/:id/decision` (strict body `{ decision: z.enum(["approve","deny"]) }`) using `claim` then the executor (try/catch → `{ ok, result | message }`) and `decisionOutcome`, validated with Zod response schemas; map `UnknownApprovalError`→404 and `ApprovalNotPendingError`→409 with the approval; make T044 pass

### Web for User Story 3

- [X] T055 [P] [US3] Extend `web/tests/lib/api-client.test.ts` and `web/tests/lib/chat-state.test.ts`: `chat` with HTTP 202 → `{ kind: "approval", body }`; `decide(id, "approve"|"deny")` 200 → final answer, 409 → `{ kind: "not_pending" }`, 404 → `not_pending`; `getApproval(id)`; reducer `awaitingApproval`, `decisionSent` (blocks a second send and new messages), `decided` (stores `final`), `decisionRefused` (`not_pending`)
- [X] T056 [P] [US3] Write `web/tests/components/approval-card.test.tsx`: card has `role="region"` labelled "Aprovação necessária", shows description, "Ferramenta: resolve_incident", "Alvo: <target>", args and "Expira às HH:MM"; `Aprovar` is the primary button; clicking either disables both with `aria-busy`; after approve shows "Aprovado" (text + icon), the final answer and its "Ver raciocínio"; deny shows "Negado"; 409 shows "Não está mais pendente"; `axe-core` clean
- [X] T057 [US3] Extend `web/src/lib/api-schemas.ts` (`approvalSchema`, `pendingApprovalResponseSchema`, `decisionResponseSchema`, `notPendingResponseSchema`), `web/src/lib/api-client.ts` (`chat` handles 202, `decide`, `getApproval`) and `web/src/lib/chat-state.ts` (approval actions); make T055 pass
- [X] T058 [US3] Create `web/src/components/ApprovalCard.tsx` and render it from `Turn.tsx` for `awaiting_approval` turns, wiring `decide` in `App.tsx`; make T056 pass

**Checkpoint**: quickstart step 3 passes against the real API.

---

## Phase 6: User Story 4 - Settings gear with the API address (Priority: P2)

**Goal**: Gear opens a dialog to view, validate, test and save the API URL.

**Independent Test**: Invalid URL blocked with a field message; valid URL tested "Conectado", saved, survives a reload, and the next message starts a new conversation.

### Tests for User Story 4

- [X] T059 [P] [US4] Extend `web/tests/lib/settings.test.ts`: `validateApiUrl` accepts `http://localhost:3000` and `https://ops.example/api/` (trailing `/` removed), rejects `ftp://x`, `localhost:3000`, `http://user:pw@x`, URLs with `?q` or `#h`, empty (pt-BR messages, e.g. "Informe uma URL http ou https completa."); `saveApiUrl`/`loadApiUrl` round-trip under `opspilot.apiUrl`; a storage that throws on read/write → default URL and no crash
- [X] T060 [P] [US4] Extend `web/tests/lib/api-client.test.ts`: `testConnection()` calls `GET <base>/stats?since=1m` and returns `{ ok: true }` on 2xx, "Não foi possível conectar à API (rede ou CORS)." on `TypeError`, "Resposta inesperada da API (HTTP n)." otherwise; reducer `apiChanged` clears `conversationId`
- [X] T061 [P] [US4] Write `web/tests/components/settings-dialog.test.tsx`: gear button has `aria-label="Configurações"`; dialog shows the current URL; invalid input shows the error linked by `aria-describedby` and blocks `Salvar`; `Testar conexão` result in `role="status"`; `Esc`/`Cancelar` closes without changes and returns focus to the gear; `Salvar` persists and triggers `apiChanged`; `axe-core` clean (stub `HTMLDialogElement.showModal`/`close` if jsdom lacks them)

### Implementation for User Story 4

- [X] T062 [US4] Complete `web/src/lib/settings.ts` (`validateApiUrl` with `z.url()` + protocol/credential/query/hash rules, `saveApiUrl`) and add `testConnection` to `web/src/lib/api-client.ts` and `apiChanged` to `web/src/lib/chat-state.ts`; make T059 and T060 pass
- [X] T063 [US4] Create `web/src/components/SettingsDialog.tsx` (native `<dialog>` with `showModal()`, `URL da API` field, `Testar conexão`, `Cancelar`, `Salvar` primary) and the gear button in the `App.tsx` header; rebuild the client on save; make T061 pass

**Checkpoint**: quickstart step 4 passes.

---

## Phase 7: User Story 5 - Served under /opspilot/ and allowed across origins (Priority: P3)

**Goal**: The production build works under `/opspilot/` from another origin than the API.

**Independent Test**: `npm run build --prefix web && npm run preview --prefix web`, open `http://localhost:4173/opspilot/`, chat works; a disallowed origin gets no CORS headers.

- [X] T064 [P] [US5] Write `web/tests/build/base-path.test.ts` that runs Vite's `build()` programmatically into a temp dir and asserts every `<script src>`/`<link href>` in the generated `index.html` starts with `/opspilot/` and the referenced files exist
- [X] T065 [P] [US5] Add a server test in `tests/http/server.test.ts` with `corsOrigins: ["http://localhost:4173"]`: preflight and `POST /approvals/:id/decision` from that origin succeed with CORS headers; `http://localhost:5173` is then refused
- [X] T066 [US5] Document in `README.md` a "War Room (web/)" section: install, `npm run dev --prefix web` (`http://localhost:5173/opspilot/`), build/preview, deploying `web/dist` under `/opspilot/` on any static host, and setting `OPSPILOT_CORS_ORIGINS` to the war room origin (never `*`)

**Checkpoint**: quickstart step 5 passes.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T067 [P] Create `web/src/components/ThemeToggle.tsx` (button with accessible name "Tema: claro/escuro/sistema", cycles system → light → dark, sets `data-theme` on `<html>`, persists `opspilot.theme` with try/catch) with `web/tests/components/theme-toggle.test.tsx`; follows OS changes live when on "sistema"
- [X] T068 [P] Add keyboard-only test `web/tests/components/keyboard.test.tsx`: Tab order header (Nova conversa, tema, gear) → conversation controls (Ver raciocínio, Aprovar/Negar, Tentar de novo) → composer; every action reachable without a pointer
- [X] T069 [P] Update `specs/016-war-room-web/contracts/http-api.md` and `README.md` sections "Rastreamento e logs"/"Estatísticas" to mention 202 records and the `approval` trace kind
- [X] T070 Run `npm run typecheck && npm test` at the root and `npm run typecheck --prefix web && npm test --prefix web && npm run build --prefix web`; fix failures (only the pre-existing `forget_preference` failure may remain)
- [ ] T071 Run quickstart.md steps 1–6 against the real API (requires the operator's `.env`; left to the user if not available) and record the outcome in this file
  - 2026-10-24: not run by the agent — it needs the operator's `.env` (OpenRouter key), which the agent must not read. Automated coverage: root 307/308 (only the pre-existing `forget_preference` failure), web 78/78, web build OK.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: depends on Setup; blocks every story (tokens, shell, API client base, CORS).
- **US1 (Phase 3)**: depends on Phase 2.
- **US2 (Phase 4)**: depends on US1 (`Turn.tsx`, answered turns).
- **US3 (Phase 5)**: API tasks T035–T054 depend only on Phase 2 and can start in parallel with US1/US2; web tasks T055–T058 depend on US1 (and US2 for the final trace).
- **US4 (Phase 6)**: depends on Phase 2 and US1 (`App.tsx` header, reducer).
- **US5 (Phase 7)**: depends on Phase 2 (CORS) and Setup (Vite config); best after US1.
- **Polish (Phase 8)**: after the stories you ship.

### Within Each User Story

- Tests first (must fail), then models/stores → services → routes/components → wiring.
- API order in US3: T045/T046/T047 → T048 → T049 → T050/T051 → T052 → T053 → T054.

### Parallel Opportunities

- Setup: T002–T005 together.
- Foundational: T007–T010 (tests) together; T011, T016 together.
- US1: T018/T019 together; T021/T022/T023 together.
- US2: T027/T028/T029 together; T032/T033 together.
- US3: T035–T043 together (all different files); T045/T046/T047 together; T055/T056 together; the whole API half of US3 in parallel with US1/US2 web work.
- US4: T059/T060/T061 together.
- US5: T064/T065 together.

---

## Parallel Example: User Story 3 (API)

```text
Task: "T037 approval-context tests in tests/approval/approval-context.test.ts"
Task: "T038 approval store tests in tests/approval/sqlite-approval-store.test.ts"
Task: "T040 ApprovalAwareToolNode tests in tests/strategies/approval-tool-node.test.ts"
Task: "T043 approval-service tests in tests/approval/approval-service.test.ts"
```

---

## Implementation Strategy

### MVP First (US1 + US2)

1. Phase 1 → Phase 2 (CORS included).
2. US1 → validate quickstart step 1.
3. US2 → validate step 2. **Stop and demo**: read-only war room with auditable answers.

### Incremental Delivery

1. MVP (US1 + US2).
2. US3 (approval gate + card) — the only story that changes API behaviour of `/chat`.
3. US4 (settings) → US5 (base path deploy) → Polish (theme toggle, keyboard pass).

### Parallel Team Strategy

- Developer A: web (Phases 3, 4, then T055–T058, Phase 6).
- Developer B: API half of US3 (T035–T054), then T065.

---

## Notes

- `[P]` = different files, no dependency on unfinished tasks.
- Never render model/tool text with `dangerouslySetInnerHTML`.
- Never read or print `.env`; `.env.example` gets only placeholder keys.
- Commit only when the user asks.
