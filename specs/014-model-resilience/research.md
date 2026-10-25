# Research: Model Resilience

Findings were checked against the installed sources (`@langchain/core` 1.2.14,
`@langchain/openai` 1.6.2, `@langchain/langgraph` 1.4.18) and the current code.

## R1. Where retry and reserve live: a `BaseChatModel` wrapper, not a bare runnable

- **Decision**: `createModel()` returns `ResilientChatModel extends BaseChatModel`. It overrides
  `invoke`, `bindTools` and `withStructuredOutput`. Each returns/uses a per-call runnable built by
  one helper: `build(primary).withRetry({ stopAfterAttempt: attempts, onFailedAttempt })`
  `.withFallbacks([reserveStep])` (the reserve step runs `build(reserve).withRetry(...)` too), where `build` is identity (`invoke`), `m => m.bindTools(tools, kw)`
  or `m => m.withStructuredOutput(schema, cfg)`. `_generate` delegates to the same path as a safety net.
- **Rationale**: `withRetry()`/`withFallbacks()` (named by the user) return plain `Runnable`s with no
  `bindTools`/`withStructuredOutput`. The router, planner/replanner and critic call
  `withStructuredOutput`, and `createReactAgent` calls `llm.bindTools(tools)` when the model has it.
  Applying retry/fallback *after* binding keeps each model's own structured-output method
  (`ChatOpenAI` json-schema/function calling) and also retries structured-output parse failures
  (the "empty structured output" seen in live runs). Overriding `invoke` avoids a nested chat-model
  run, so callbacks (`handleChatModelStart`, usage recorder) fire once per real provider attempt.
- **Alternatives considered**:
  - `createModel()` returning `primary.withRetry().withFallbacks([reserve])` — breaks every
    `withStructuredOutput`/`bindTools` call site.
  - Apply retry/fallback at each call site — five call sites to change and easy to miss (arena,
    bench, MCP).
  - LangChain v1 agent middleware (`modelRetryMiddleware`/`modelFallbackMiddleware`) — only for
    `createAgent`; the router, planner and critic are not agents.

## R2. Retry policy and transient vs. non-transient errors

- **Decision** (updated at implementation to follow the user's snippet): default `attempts = 2`
  (`stopAfterAttempt: 2`) on the primary **and** on the reserve. Build both
  `ChatOpenAI` instances with `maxRetries: 0`. A pure `classifyModelError(error)` returns:
  - `abort` — `StrategyLimitError`, `ConfigurationError`, `AbortError`/aborted signal: rethrow as-is,
    no retry, no reserve.
  - `permanent` — HTTP status 400, 401, 403, 404, 422: no retry, go to the reserve.
  - `transient` — 408, 409, 425, 429, ≥ 500, no status (network/timeout), output-parser errors: retry.
  `onFailedAttempt` throws for non-`transient` errors, which stops p-retry immediately.
- **Rationale**: `ChatOpenAI` retries 6 times by default through its `AsyncCaller`; stacked with
  our attempts that is up to 14 calls before the reserve. One retry layer keeps latency bounded
  and testable. p-retry already refuses to retry non-network `TypeError`s (programming errors).
- **Backoff**: LangChain's `RunnableRetry` uses p-retry with `minTimeout` 1000 ms, `factor` 2 and
  `randomize: true` (not configurable): 1–2 s before the second attempt. Worst case ≈ 2 s before the reserve (and ≈ 2 s more on it),
  well inside the 180 s turn timeout. Tests use `attempts: 1` for reserve scenarios and `attempts: 2`
  only where a retry is the point (one 1–2 s wait) to stay fast.
- **Alternatives considered**: custom retry loop with injectable sleep (faster tests, but drops the
  user-named `withRetry`); per-request `timeout` on `ChatOpenAI` to turn hangs into failures
  (useful, but not in the spec — a hang still ends as 504).

## R3. Detecting the switch and the final failure

- **Decision**: the `reserveStep` is a `RunnableLambda` created per call. It reads the primary's
  last error captured by `onFailedAttempt` (per-call closure, so concurrent calls do not mix),
  rethrows it if `classifyModelError` is `abort`, otherwise reports the fallback
  (`reportModelFallback({ primaryModel, reserveModel, reason })`, reason redacted and capped at
  300 chars), logs one `console.error` line, then invokes the reserve. The wrapper catches the
  final error of the chain and, unless it is `abort`, throws
  `ModelUnavailableError("Language models are unavailable; try again later.", { cause })`.
- **Rationale**: `RunnableWithFallbacks.invoke` rethrows the **first** (primary) error when all
  options fail, so the reserve's own error never surfaces; translating at the wrapper gives one
  domain error for "no model worked" with or without a reserve (spec US1-3 → US3).
- **Alternatives considered**: inspecting callbacks (`handleChainError`) to infer the switch —
  indirect and order-dependent.

## R4. Getting `fallback` events into the right graph node

- **Decision**: `src/llm/model-events.ts` holds an `AsyncLocalStorage<ModelFallbackReport[]>`:
  `collectModelFallbacks(fn)` runs `fn` in a fresh scope and returns `{ value, fallbacks }`;
  `reportModelFallback(report)` pushes into the current scope (no-op outside one). The production
  graph wraps the `context`, `router` and strategy node bodies; reports become
  `{ type: "fallback", node }` events placed at the start of that node's trace block. Inside a
  strategy node, the ReAct fallback run is collected separately and tagged `react`, matching the
  feature 013 tagging. If a node throws, its scope is discarded with the turn (503/500).
- **Rationale**: model instances are created once (router, registry strategies) and reused across
  turns, so per-turn state cannot live in the model. Callback propagation differs per call site
  (explicit `callbacks` arrays, `createReactAgent` streams); an async-context scope needs no
  call-site changes and works for arena/bench/MCP as a silent no-op (they still get the log line).
- **Alternatives considered**: custom callback events (`handleCustomEvent`) — requires every call
  site to pass a collector and LangGraph config to flow through; passing a recorder through
  every strategy's options — wide signature churn.

## R5. `metrics.modelUsed` and model identity

- **Decision**: pure `resolveModelUsed(trace, primaryModel)` → `reserveModel` of the first
  `fallback` event, else `primaryModel`. The graph receives `primaryModel` in its dependencies;
  `createChatServer` takes an optional `models: { primary }` (default
  `readModelSettings(process.env, { lenient: true }).primary`, which is `"unconfigured"` when
  `OPENROUTER_MODEL` is absent so fake-model tests still produce a valid response).
- **Rationale**: the trace already carries the reserve id; only the primary id must be known.
  Keeps `modelUsed` a single string per turn (spec assumption).

## R6. Settings and the "no reserve" notice

- **Decision**: `readModelSettings(env)` (Zod) returns `{ apiKey, primary, reserve: string | null,
  reserveIgnored: "same-as-primary" | null }`; empty/blank → `reserve: null`; equal to primary →
  `reserve: null`, `reserveIgnored: "same-as-primary"`. Missing key/primary → `ConfigurationError`
  (unchanged). `startChatServer` logs one line at startup: reserve enabled, not configured, or
  ignored because equal to the primary. The factory itself never logs about configuration.
- **Rationale**: "reported once at startup" without module-level mutable flags; the factory is
  called lazily many times.

## R7. 503 at the edge and auxiliary fallbacks

- **Decision**: `src/http/server.ts` maps `ModelUnavailableError` → `503 { error: message }` next to
  the existing 404/422/504 branches. Persistence already happens only after `graph.run` succeeds,
  so a 503 writes nothing. No change to `decideRoute` (catches all → `react`, `source: "fallback"`),
  `prepareConversationHistory` (catches → keeps previous summary) or the strategy node (non-ReAct
  failure → ReAct). ReAct rethrows non-budget errors, so its `ModelUnavailableError` reaches the edge.
- **Rationale**: FR-006–FR-009 with the smallest change; the domain error is translated only at
  the HTTP edge (constitution III). Arena/bench/MCP keep their current `stderr` error output.

## R8. Type changes at call sites

- **Decision**: `router.ts`, `plan-and-execute.ts` and `reflection.ts` annotate `model?: ChatOpenAI`;
  change to `BaseChatModel` (as `react.ts`, `strategy.ts` and the summarizer already do). The model
  test keeps checking the primary's endpoint/temperature through a read-only accessor on the
  wrapper (e.g. `primaryModel`), plus `maxRetries === 0`.
- **Verification during implementation**: one test runs the real `createReactAgent` with
  `ResilientChatModel` over scripted fakes to confirm the `bindTools` path (the fake must
  implement `bindTools`).
