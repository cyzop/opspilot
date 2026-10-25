# Quickstart: Context Token Metrics

## Prerequisites

- Node.js 22 LTS, dependencies installed (`npm install`).
- For live runs: `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` configured in `.env`
  (loaded by the npm scripts; do not print it).
- Bash with `curl` (Git Bash on Windows).

## 1. Automated validation

```bash
npm run typecheck
npm test
```

Expected: both green. New tests cover (see [data-model.md](./data-model.md)):

- `tests/context/tokens.test.ts` — `estimateTokens` (empty, rounding, non-ASCII),
  `inputTokensFromLlmResult` (message usage, `llmOutput` fallback, missing/malformed),
  `sumPromptTokens` (empty, null propagation, sum), usage recorder handler,
  `estimateContextBreakdown`.
- `tests/http/compose-chat-prompt.test.ts` (or existing server tests) — `composeChatContext`
  sections match the prompt and the 12-message window.
- `tests/strategies/*` — ReAct, Plan-and-Execute and Reflection report summed
  `promptTokens` from scripted `handleLLMEnd` usage, and `null` when any call lacks usage.
- `tests/http/server.test.ts` — `/chat` metrics contain `promptTokens` and
  `contextBreakdown` per [contracts/chat-metrics.md](./contracts/chat-metrics.md).

## 2. Single live turn

```bash
npm run dev            # or the chat server entry point, in terminal A
curl -s -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Quais alertas estão abertos?"}'
```

Expected: `metrics.promptTokens` is a positive integer (or `null` if the provider
omitted usage) and `metrics.contextBreakdown` has `method: "chars/4"` with
`history: 0`, `memory: 0`.

## 3. Long conversation

```bash
TURNS=12 npm run conversa-longa
```

Expected (see [contracts/conversa-longa-cli.md](./contracts/conversa-longa-cli.md)):
one line per turn, all in the same conversation; `history` estimate grows until turn 7
(12 messages in the window) and then stays roughly flat, and `promptTokens` follows the
same shape. Stopping the server mid-run makes the script exit with status 1.
