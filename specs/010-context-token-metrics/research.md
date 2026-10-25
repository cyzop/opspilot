# Research: Context Token Metrics

All Technical Context items were resolvable from the repository and the installed
dependency sources (`@langchain/core@1.2.14`, `@langchain/openai@1.6.2`). Context7
was attempted for LangChain docs but rejected its API key, so findings below were
verified directly against `node_modules/@langchain/*/dist`.

## R1. Where the "real" usage comes from

- **Decision**: Read provider usage in a LangChain callback `handleLLMEnd(output: LLMResult)`, taking
  `output.generations[*][*].message.usage_metadata.input_tokens`, falling back to
  `output.llmOutput.tokenUsage.promptTokens` when the message field is absent.
- **Rationale**: `@langchain/openai` (`chat_models/completions.js`) fills both
  `generation.message.usage_metadata.input_tokens` and `llmOutput.tokenUsage.promptTokens`
  from the OpenAI-compatible `usage.prompt_tokens`, which OpenRouter returns. `handleLLMEnd`
  fires for every chat-model run, including those hidden behind `withStructuredOutput`
  (plan-and-execute planner/replanner, reflection critic) and inside `createReactAgent`.
- **Alternatives considered**:
  - Reading `usage_metadata` from the returned `AIMessage`s: works for ReAct's message
    list, but `withStructuredOutput` returns the parsed object and discards the raw message
    unless `includeRaw: true`, which would change three call sites and their parsing.
  - Local tokenizer (tiktoken): not "real" usage, adds a dependency, model-dependent.

## R2. Isolating usage per chat turn

- **Decision**: Create a per-run usage recorder inside each strategy's `run()` (alongside the
  existing `createRunContext`) and pass its handler through the per-invocation `callbacks`
  config (`agent.stream(..., { callbacks })`, `structuredModel.invoke(messages, { callbacks })`).
- **Rationale**: Strategy instances are singletons in the registry and shared by concurrent
  requests; attaching callbacks to the model constructor would mix turns. ReAct already
  passes per-run `callbacks` and reflection already does for the critic, so this follows the
  existing pattern. LangChain propagates config callbacks to child chat-model runs.
- **Alternatives considered**: `AsyncLocalStorage` (implicit, harder to test); a model
  wrapper per request (requires changing the registry lifecycle).

## R3. Aggregation and unavailability

- **Decision**: `promptTokens` = sum of `input_tokens` over all `handleLLMEnd` events in the
  turn; `null` if any event lacks valid usage or if no event was observed at all.
  Reflection combines base-strategy `promptTokens` of every regeneration with critic usage
  using the same null-propagating sum.
- **Rationale**: Spec FR-004 and the constitution's "no success fallback for failures"
  forbid presenting a partial sum or 0 as real. Injected fakes (`agentRunner`, custom
  `planner`/`critic`) emit no LangChain events, so they correctly yield `null`.
- **Alternatives considered**: Reporting the partial sum plus a `complete` flag — more
  surface area with little learning value.

## R4. Backward compatibility of `StrategyResult`

- **Decision**: Add `promptTokens: z.number().int().nonnegative().nullable().optional()` to
  `strategyResultSchema.shape.metrics`. The HTTP response schema makes it required and
  nullable (`result.metrics.promptTokens ?? null`).
- **Rationale**: Existing fakes and tests construct metrics with only `llmCalls`/`latencyMs`;
  keeping the field optional at the strategy layer avoids touching them (SC-006), while the
  HTTP contract stays explicit.

## R5. Estimation rule and breakdown source text

- **Decision**: `estimateTokens(text) = Math.ceil(text.length / 4)` (UTF-16 `length`, 0 for
  `""`). Breakdown is computed over the exact rendered section strings that make up the
  prompt sent to the strategy: refactor `composeChatPrompt` into `composeChatContext`
  returning `{ prompt, sections: { history, memory, message } }`, keeping
  `composeChatPrompt` as a thin wrapper.
- **Rationale**: FR-006 requires estimating exactly what was sent, after the 12-message
  window. Rendering once and measuring the same strings guarantees that; headers belong to
  the source they introduce. When there is no history/memory the prompt is the bare message,
  so `message` is the bare message and the others are `""` → 0.
- **Alternatives considered**: Estimating raw inputs (history array, fact list) — would
  drift from the actual prompt format and ignore truncation.

## R6. `conversa-longa.sh` implementation

- **Decision**: Bash script at `scripts/conversa-longa.sh`, using `curl` for HTTP and
  `node -e` (always present) for JSON building/parsing; configuration via environment
  variables `OPSPILOT_URL` (default `http://localhost:3000`), `TURNS` (default 10),
  `STRATEGY` (default `react`). Exposed as `npm run conversa-longa`.
- **Rationale**: User named a `.sh` script; `jq` is not guaranteed on Windows Git Bash while
  Node is. `set -euo pipefail` plus `curl --fail-with-body` gives non-zero exit on errors.
  The script never reads `.env` (the server loads its own config).
- **Alternatives considered**: TypeScript CLI (testable, but diverges from the requested
  artifact); `jq` (extra prerequisite).
