# Quickstart: Model Resilience

Validation guide. Contract details: [contracts/chat-model-resilience.md](./contracts/chat-model-resilience.md);
entities and rules: [data-model.md](./data-model.md).

## Prerequisites

- Node.js 22 LTS, `npm install` done.
- `.env` with `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` (do not print it). For the live checks,
  add `OPENROUTER_MODEL_FALLBACK=<another model id>` by editing the file in your editor.

## 1. Automated checks (no provider calls)

```bash
npm run typecheck
npm test
```

Expected: both green. The suite covers, with the scripted fake model:

| Scenario | Expected |
|----------|----------|
| primary fails once, then succeeds | answer from primary, no `fallback` event, `modelUsed` = primary |
| primary always fails, reserve ok | answer, one `fallback` event per call with the node, `modelUsed` = reserve |
| permanent error (400) on primary | no retry, straight to reserve |
| `StrategyLimitError` / abort | rethrown, no retry, no reserve |
| no reserve, primary always fails | `ModelUnavailableError` |
| reserve equal to primary | treated as no reserve |
| both always fail (chat) | 503, nothing appended to the conversation |
| router / summarizer fail on both | `route` `source: "fallback"` / `summarize` `status: "failed"`, turn still 200 |
| `createReactAgent` with the resilient model | tools bound, answer returned |

## 2. Live check — healthy primary

```bash
npm run dev
curl -s -X POST http://localhost:3000/chat -H "Content-Type: application/json" \
  -d '{"message":"Quais alertas estão abertos?"}'
```

Expected: startup line `Model fallback enabled: … → …`; 200 with `metrics.modelUsed` equal to
`OPENROUTER_MODEL` and no `fallback` events.

## 3. Live check — reserve used

Set `OPENROUTER_MODEL` to a non-existent model id (for example `invalid/does-not-exist`), keep a
valid `OPENROUTER_MODEL_FALLBACK`, restart `npm run dev`, repeat the request.

Expected: 200; `fallback` events tagged `router` and the strategy node; `metrics.modelUsed`
equal to the reserve; one `Model fallback …` line per switched call in the server log.

## 4. Live check — no model available

Set both `OPENROUTER_MODEL` and `OPENROUTER_MODEL_FALLBACK` to non-existent ids, restart, repeat
the request with an existing `conversationId`.

Expected: `503 {"error":"Language models are unavailable; try again later."}`; the conversation
has no new messages.

## 5. CLIs

```bash
npm run arena
npm run bench
```

Expected with an invalid primary and valid reserve: runs complete and log the model switch; with
both invalid: the existing `Arena error: …` / `Benchmark error: …` output.

Restore `.env` to the original model ids afterwards.
