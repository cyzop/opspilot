---

description: "Task list for Model Resilience"
---

# Tasks: Model Resilience

**Input**: Design documents from `/specs/014-model-resilience/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/chat-model-resilience.md, quickstart.md

**Tests**: Required by the spec (FR-010, FR-011) and constitution IV. Tests first; they must fail before the implementation. No test may call a real provider: models come from the scripted fake in `tests/helpers/fake-chat-model.ts` injected through `createModel(env, { buildChatModel })`.

**Implementation note**: per the `/speckit-implement` input (`withRetry({ stopAfterAttempt: 2 })` on primary *and* reserve, then `withFallbacks`), the factory option is `attempts` (default `DEFAULT_MODEL_ATTEMPTS = 2`) instead of `retries`, and the reserve is retried like the primary. Where tasks below say `retries: n`, read `attempts: n + 1`.

**Organization**: US1 = retry on the primary + switch to the reserve (factory), US2 = `fallback` trace event + `metrics.modelUsed`, US3 = 503 when no model works.

## Format: `[ID] [P?] [Story] Description`

- Paths are relative to the `ops-pilot/` project root
- `[P]` = different file, no dependency on an unfinished task

---

## Phase 1: Setup

- [X] T001 [P] Add `OPENROUTER_MODEL_FALLBACK=` (empty value, no secrets) after `OPENROUTER_MODEL` in `.env.example`; add optional `OPENROUTER_MODEL_FALLBACK?: string` to `OpenRouterEnvironment` in `src/llm/model.ts`
- [X] T002 [P] Add `export class ModelUnavailableError extends OpsPilotError {}` to `src/domain/errors.ts`
- [X] T003 [P] Create `tests/helpers/fake-chat-model.ts` exporting `createFakeChatModel(name: string, script: readonly (Error | string | Record<string, unknown>)[] | (() => Error | string | Record<string, unknown>))` that returns `{ model, calls: { method: "invoke" | "tools" | "structured"; input: unknown }[] }`. `model` is a `BaseChatModel` subclass (`_llmType() = "fake"`): each call consumes the next script step (last step repeats when the script runs out; a function is called each time); an `Error` step is thrown; a string step is returned as `AIMessage` content; an object step is returned as the parsed result by the runnable from `withStructuredOutput(schema)`. `bindTools(tools)` returns a runnable that records `"tools"` and uses the same script (string → `AIMessage` with no tool calls). Each attempt must trigger `handleChatModelStart` on passed callbacks. Also export `httpError(status: number, message = \`HTTP ${status}\`)` returning an `Error` with a numeric `status` property

## Phase 2: Foundational (blocks all stories)

- [X] T004 [P] Write failing tests in `tests/llm/model-errors.test.ts` for `classifyModelError`: `StrategyLimitError`, `ConfigurationError`, an error named `AbortError` → `"abort"`; `httpError(400|401|403|404|422)` → `"permanent"`; `httpError(408|409|425|429|500|502|503)`, a plain `Error("socket hang up")` and an `OutputParserException` (from `@langchain/core/output_parsers`) → `"transient"`; also `ModelUnavailableError` → `"abort"` (already final, never wrapped again)
- [X] T005 Create `src/llm/model-errors.ts` exporting `type ModelErrorClass = "abort" | "permanent" | "transient"` and pure `classifyModelError(error: unknown): ModelErrorClass` per the table in data-model.md (status read from `error.status` or `error.response?.status` when numeric). Makes T004 pass
- [X] T006 [P] Write failing tests in `tests/llm/model.test.ts` for `readModelSettings(env)`: trims values; missing/blank `OPENROUTER_API_KEY` or `OPENROUTER_MODEL` → `ConfigurationError` (existing cases kept); blank or missing `OPENROUTER_MODEL_FALLBACK` → `reserve: null, reserveIgnored: null`; fallback equal to primary (after trim) → `reserve: null, reserveIgnored: "same-as-primary"`; distinct fallback → `reserve: "<id>"`. Add `readModelSettings(env, { lenient: true })` → never throws, `primary` = `"unconfigured"` when absent
- [X] T007 Implement `readModelSettings(env, options?: { lenient?: boolean })` in `src/llm/model.ts` with a Zod schema, returning `ModelSettings { apiKey: string; primary: string; reserve: string | null; reserveIgnored: "same-as-primary" | null }`; keep the existing `ConfigurationError` message. Makes T006 pass
- [X] T008 [P] Write failing tests in `tests/llm/model-events.test.ts`: `collectModelFallbacks(fn)` returns `{ value, fallbacks }` with reports made inside `fn` (including after `await`s and inside nested promises); reports from two concurrent `collectModelFallbacks` calls do not mix; nested scopes keep reports in the innermost scope only; `reportModelFallback` outside any scope is a no-op (no throw)
- [X] T009 Create `src/llm/model-events.ts` with an `AsyncLocalStorage<ModelFallbackReport[]>` from `node:async_hooks`, exporting `interface ModelFallbackReport { primaryModel: string; reserveModel: string; reason: string }`, `collectModelFallbacks<T>(fn: () => Promise<T>): Promise<{ value: T; fallbacks: ModelFallbackReport[] }>` and `reportModelFallback(report: ModelFallbackReport): void`. Makes T008 pass
- [X] T010 [P] Write failing tests in `tests/trace/trace.test.ts` for the `fallback` event `{ type: "fallback", node?, content, primaryModel, reserveModel, reason }`: validates; rejects empty `primaryModel`/`reserveModel`, `reason` empty or > 300 chars, and unknown keys (strict); `sanitizeTraceEvent` redacts `api_key=...` in both `reason` and `content`; `formatTrace` prints it as `N. fallback: <content>`
- [X] T011 Add the strict `fallback` variant to `traceEventSchema` in `src/trace/trace.ts`: `{ type: z.literal("fallback"), content: z.string(), primaryModel: z.string().min(1), reserveModel: z.string().min(1), reason: z.string().trim().min(1).max(300), node }`; extend `sanitizeTraceEvent` to sanitize `reason` for `fallback` as it does for `route`. Makes T010 pass
- [X] T012 [P] Change model type annotations from `ChatOpenAI` to `BaseChatModel` (import from `@langchain/core/language_models/chat_models`) in `src/graph/router.ts` (`createLlmRouter(model?)`), `src/strategies/plan-and-execute.ts` (`model?`, `getModel`) and `src/strategies/reflection.ts` (both `model?` fields); remove unused `ChatOpenAI` imports; `npm run typecheck` and `npm test` stay green

**Checkpoint**: settings, error classes, recorder and trace schema ready; no behavior change yet.

---

## Phase 3: User Story 1 - Answers survive a flaky or unavailable primary (Priority: P1) 🎯 MVP

**Goal**: every model from `createModel()` retries the primary and then switches to the reserve; `ModelUnavailableError` when nothing works.

**Independent Test**: with scripted fakes, primary fails once then succeeds → answer from primary; primary always fails → answer from reserve; no reserve → `ModelUnavailableError`.

### Tests for User Story 1

- [X] T013 [US1] Write failing factory tests in `tests/llm/model.test.ts` using `createModel(env, { buildChatModel, retries })` where `buildChatModel(modelName)` returns the fake for that name: (a) `retries: 1`, primary script `[httpError(503), "ok"]` → `invoke` returns `"ok"`, primary called 2 times, reserve 0; (b) `retries: 0`, primary always `httpError(503)`, reserve `"reserva"` → returns `"reserva"`; (c) primary `httpError(400)` with `retries: 2` → primary called once, reserve used; (d) primary throws `StrategyLimitError` → same error rethrown, reserve not called; (e) no `OPENROUTER_MODEL_FALLBACK`, primary always fails, `retries: 0` → rejects with `ModelUnavailableError` whose message is `"Language models are unavailable; try again later."` and whose `cause` is the primary error; (f) both always fail → `ModelUnavailableError`; (g) fallback equal to primary → reserve never built/called, `ModelUnavailableError`; (h) `withStructuredOutput(schema).invoke` and `bindTools([tool]).invoke` follow the same retry/reserve rules (calls recorded as `"structured"` / `"tools"` on the reserve); (i) default `retries` is 2 (primary `httpError(503)` ×3 then `"ok"` is NOT reached — assert 3 primary calls before the reserve; mark this case with a ~6 s timeout or check the configured attempt count via an exported `DEFAULT_MODEL_RETRIES = 2` instead of waiting)
- [X] T014 [US1] Update the existing test "configures the OpenRouter model…" in `tests/llm/model.test.ts`: `createModel(...)` without `buildChatModel` exposes `primaryModel` (a `ChatOpenAI`) with `model === "openrouter/test-model"`, `temperature === 0`, `clientConfig.baseURL === "https://openrouter.ai/api/v1"` and `maxRetries === 0`; with a distinct `OPENROUTER_MODEL_FALLBACK`, `reserveModel` has the same settings and the reserve id
- [X] T015 [P] [US1] Write a failing integration test in `tests/strategies/react.test.ts`: `createReactStrategy({ maxIterations: 4, model: createModel(env, { buildChatModel, retries: 0 }), tools: [] })` with primary always `httpError(503)` and reserve `"Resposta da reserva"` → `run("oi")` returns answer `"Resposta da reserva"` (proves the `createReactAgent` → `bindTools` path); with both failing → rejects with `ModelUnavailableError`

### Implementation for User Story 1

- [X] T016 [US1] Implement `ResilientChatModel extends BaseChatModel` in `src/llm/model.ts` per research R1–R3: fields `primaryModel`, `reserveModel?`, `primaryName`, `reserveName?`, `retries`; private `runResilient(build: (m: BaseChatModel) => Runnable, input, config)` that, per call, captures the last primary error in a closure and runs `build(primary).withRetry({ stopAfterAttempt: retries + 1, onFailedAttempt: (e) => { lastError = e; if (classifyModelError(e) !== "transient") throw e; } })`, then (if a reserve exists) `.withFallbacks([RunnableLambda.from(async (i, c) => { if (classifyModelError(lastError) === "abort") throw lastError; report…; return build(reserve).invoke(i, c); })])`; on final error: rethrow if `classifyModelError(error) === "abort"`, else throw `new ModelUnavailableError("Language models are unavailable; try again later.", { cause: error })`. Override `invoke(input, config)` → `runResilient((m) => m, …)`; `bindTools(tools, kwargs)` → a `Runnable` whose `invoke` calls `runResilient((m) => m.bindTools!(tools, kwargs), …)`; `withStructuredOutput(schema, config)` → same with `m.withStructuredOutput(schema, config)`; `_generate` delegates to the primary/reserve path as a safety net; `_llmType()` returns `"resilient"`. Export `DEFAULT_MODEL_RETRIES = 2`
- [X] T017 [US1] Rewrite `createModel(env = process.env, options: { retries?: number; buildChatModel?: (model: string, apiKey: string) => BaseChatModel } = {})` in `src/llm/model.ts`: settings from `readModelSettings(env)`; default `buildChatModel` = `new ChatOpenAI({ model, apiKey, configuration: { baseURL: "https://openrouter.ai/api/v1" }, temperature: 0, maxRetries: 0 })`; reserve built only when `settings.reserve !== null`; validate `retries` as a non-negative safe integer (Zod); return `ResilientChatModel`. Makes T013–T015 pass
- [X] T018 [US1] Run `npm run typecheck` and `npm test`; fix any call site in `src/arena.ts`, `src/bench.ts`, `src/context/llm-history-summarizer.ts`, `src/mcp/server.ts` that relied on the `ChatOpenAI` return type (expected: none beyond T012)

**Checkpoint**: US1 complete — chat, arena, bench and MCP retry and use the reserve.

---

## Phase 4: User Story 2 - The operator sees when the reserve was used (Priority: P1)

**Goal**: one `fallback` event per switched call, tagged with its graph node; `metrics.modelUsed` on every chat response.

**Independent Test**: primary always failing → `metrics.modelUsed` = reserve and `fallback` events with primary, reserve and redacted reason; healthy primary → `modelUsed` = primary and no `fallback` event.

### Tests for User Story 2

- [X] T019 [P] [US2] Add failing factory tests in `tests/llm/model.test.ts`: inside `collectModelFallbacks`, a switched call reports exactly one `{ primaryModel, reserveModel, reason }` where `reason` starts with `"Primary failed after N attempts: "`, is redacted (primary error message `"api_key=sk-123 boom"` → no `sk-123`) and is ≤ 300 chars; a call recovered by retry reports nothing; a call where both fail reports one fallback before the `ModelUnavailableError`; outside a scope the switch still works and `console.error` is called once with `Model fallback <primary> → <reserve>: <reason>`
- [X] T020 [P] [US2] Write failing tests in `tests/graph/production-graph.test.ts` (fake router/strategies/summarizer that call `reportModelFallback` to simulate a switch): a report made in the router → `fallback` event with `node: "router"`; in the summarizer → `node: "context"`; in a `plan-and-execute` strategy → `node: "plan-and-execute"`; in the ReAct run that a failing `plan-and-execute` falls back to → `node: "react"`; each node's `fallback` events come first in that node's trace block; output `metrics.modelUsed` = reserve when any `fallback` exists, else the `primaryModel` passed in dependencies; no reports → no `fallback` events
- [X] T021 [P] [US2] Add a failing pure test (same file or `tests/graph/production-graph.test.ts`) for `resolveModelUsed(trace, primaryModel)`: no `fallback` → `primaryModel`; one or more → the first event's `reserveModel`
- [X] T022 [P] [US2] Add failing tests in `tests/http/server.test.ts`: every 200 `/chat` response has `metrics.modelUsed` (string, non-empty) equal to `createChatServer({ models: { primary: "fake/primary" } })`'s primary when no fallback occurs; with a fake strategy that calls `reportModelFallback({ primaryModel: "fake/primary", reserveModel: "fake/reserve", reason: "boom" })`, `modelUsed === "fake/reserve"` and the trace contains a `fallback` event with `node` set

### Implementation for User Story 2

- [X] T023 [US2] In `src/llm/model.ts` (`runResilient` reserve step), before invoking the reserve: build `reason = sanitizeTraceText(\`Primary failed after ${attempts} attempts: ${message(lastError)}\`).slice(0, 300)` (attempts = number of primary attempts made), call `reportModelFallback({ primaryModel: primaryName, reserveModel: reserveName, reason })` and `console.error(\`Model fallback ${primaryName} → ${reserveName}: ${reason}\`)`. Makes T019 pass
- [X] T024 [US2] In `src/graph/production-graph.ts`: add `primaryModel: string` to `ProductionGraphDependencies`; add a helper `fallbackEvents(reports, node): TraceEvent[]` producing `{ type: "fallback", primaryModel, reserveModel, reason, content: \`Model fallback ${primaryModel} → ${reserveModel}: ${reason}\` }` tagged via `tagTrace`; wrap the bodies of `contextNode` (history + summarizer), `routerNode` (`decideRoute`) and each strategy run (`runStrategy(route, …)` and, separately, the ReAct fallback run) in `collectModelFallbacks`, placing the node's `fallback` events before its other events (ReAct fallback run's events tagged `react`)
- [X] T025 [US2] Add exported pure `resolveModelUsed(trace: readonly TraceEvent[], primaryModel: string): string` in `src/graph/production-graph.ts`; in `responseNode` set `metrics.modelUsed = resolveModelUsed(state.trace, primaryModel)`; extend `ProductionGraphOutput["metrics"]` type with `modelUsed: string`. Makes T020–T021 pass
- [X] T026 [US2] In `src/http/server.ts`: add `models?: { primary: string }` to `ChatServerOptions` (default `{ primary: readModelSettings(process.env, { lenient: true }).primary }`), pass `primaryModel` to `createProductionGraph`, add `modelUsed: z.string().min(1)` to `chatResponseSchema.metrics`, and include `modelUsed` in the parsed response. Update the existing `createChatServer(...)` calls in `tests/http/server.test.ts` (via the local helper) to pass `models: { primary: "fake/primary" }`. Makes T022 pass

**Checkpoint**: US1 + US2 complete — switches are visible in trace and metrics.

---

## Phase 5: User Story 3 - Clear "service unavailable" when no model works (Priority: P2)

**Goal**: 503 for model outage, nothing persisted; auxiliary fallbacks and other status codes unchanged.

**Independent Test**: both models always failing → `/chat` returns 503 with the fixed message and the conversation has no new messages.

### Tests for User Story 3

- [X] T027 [P] [US3] Add failing tests in `tests/http/server.test.ts`: a fake ReAct strategy throwing `new ModelUnavailableError("Language models are unavailable; try again later.")` → status 503, body `{ error: "Language models are unavailable; try again later." }`, and for an existing `conversationId` the store has no new messages; the same error thrown by a fake `plan-and-execute` strategy whose ReAct fallback also throws it → 503; existing 400/404/422/504/500 tests still pass unchanged
- [X] T028 [P] [US3] Add failing tests in `tests/graph/production-graph.test.ts`: a router throwing `ModelUnavailableError` → `route` event `source: "fallback"`, route `react`, turn completes; a summarizer throwing `ModelUnavailableError` → `summarize` `status: "failed"`, previous summary kept, turn completes; a failing `plan-and-execute` with a healthy ReAct → turn completes with the feature 013 `route` fallback event (FR-008)
- [X] T029 [P] [US3] Add a failing test for the startup notice in `tests/http/server.test.ts`: exported pure `describeModelFallback(settings: ModelSettings): string` returns `"Model fallback enabled: <primary> → <reserve>"`, `"Model fallback not configured: retries only on <primary>"` or `"Model fallback ignored: OPENROUTER_MODEL_FALLBACK equals OPENROUTER_MODEL"` (place the function in `src/llm/model.ts`; test may live in `tests/llm/model.test.ts`)

### Implementation for User Story 3

- [X] T030 [US3] In `src/http/server.ts` `/chat` catch block: add `if (error instanceof ModelUnavailableError) { res.status(503).json({ error: error.message }); return; }` next to the 404/422/504 branches (import from `src/domain/errors.ts`); confirm `conversationStore.append` stays after `graph.run`. Makes T027 pass
- [X] T031 [US3] Implement `describeModelFallback` in `src/llm/model.ts`; in `startChatServer` (`src/http/server.ts`) log it once with `console.log` when `readModelSettings(process.env)` succeeds (catch `ConfigurationError` and skip the notice; the first model call still reports it). Makes T029 pass
- [X] T032 [US3] Run the auxiliary-fallback tests from T028; adjust only if a catch in `src/graph/router.ts`, `src/context/conversation-history.ts` or `src/graph/production-graph.ts` filters by error type (expected: no change needed). Makes T028 pass

**Checkpoint**: all stories complete.

---

## Phase 6: Polish & Cross-Cutting

- [X] T033 [P] Update `README.md` (configuration section) with `OPENROUTER_MODEL_FALLBACK`, the retry policy (2 attempts per model), the `fallback` trace event, `metrics.modelUsed` and the 503 response, linking `specs/014-model-resilience/contracts/chat-model-resilience.md`
- [X] T034 [P] Grep `tests/` for real-provider risk: no test calls `createModel()` without `buildChatModel` except the configuration test (T014), which never invokes the model (SC-005)
- [ ] T035 Run `npm run typecheck` and `npm test`; both green
- [ ] T036 Run the live checks 2–4 from `specs/014-model-resilience/quickstart.md` (edit `.env` in the editor, never print it) and restore the original model ids

---

## Dependencies & Execution Order

- **Setup (T001–T003)**: no dependencies, all `[P]`.
- **Foundational (T004–T012)**: after Setup. Pairs test → impl: T004→T005, T006→T007, T008→T009, T010→T011. T012 independent. Blocks all stories.
- **US1 (T013–T018)**: after Foundational. T013/T014 share `tests/llm/model.test.ts` (sequential); T015 `[P]`. T016→T017→T018.
- **US2 (T019–T026)**: after US1 (needs `ResilientChatModel` for T019/T023). T020–T022 can be written in parallel with T019. T024→T025→T026.
- **US3 (T027–T032)**: after US2 (shares server/graph files and uses `models` option); its graph tests (T028) only need Foundational + US2 wiring.
- **Polish (T033–T036)**: after all stories.

Story order: US1 → US2 → US3 (US2 depends on US1's factory; US3 depends on US1's `ModelUnavailableError` path and US2's server changes).

## Parallel Examples

```text
# Setup
T001, T002, T003 together

# Foundational tests
T004 (model-errors.test.ts), T006 (model.test.ts), T008 (model-events.test.ts), T010 (trace.test.ts), T012 together

# US1
T013 (model.test.ts) with T015 (react.test.ts)

# US2 tests
T019 (model.test.ts), T020+T021 (production-graph.test.ts), T022 (server.test.ts)

# US3 tests
T027 (server.test.ts), T028 (production-graph.test.ts), T029 (model.test.ts)
```

## Implementation Strategy

1. **MVP = Setup + Foundational + US1**: answers survive a flaky or missing primary everywhere `createModel()` is used. Stop and validate with `npm test`.
2. **+ US2**: make switches visible (`fallback` events, `metrics.modelUsed`). Validate quickstart check 3.
3. **+ US3**: 503 for outages. Validate quickstart check 4.
4. Polish: docs, provider-free test audit, full green run.
