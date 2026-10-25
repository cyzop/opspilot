# Quickstart: Learning Reflector

## Prerequisites

- Node.js 22.9 or newer and installed dependencies (`npm ci`).
- For the manual scenario only: `.env` configured for OpenRouter, and the local embedding model available (see the 008 quickstart).

## Validate without a model or network

All tests use a fake structured model, a fake strategy, and deterministic embeddings.

```powershell
node --env-file-if-exists=.env --import tsx --test tests/domain/learning.test.ts tests/memory/learning-reflector.test.ts tests/memory/forget-preference.test.ts tests/tools/forget-preference.test.ts tests/http/server.test.ts
npm test
npm run typecheck
```

Expected outcomes:

- A durable preference, in English or Portuguese, is remembered for the same user only.
- One-time requests, questions, temporary state, and forget requests are never remembered.
- Every item of the secret set (password, API key, access token, private key, key-shaped values) is rejected before `remember`.
- Malformed reflector output is an error and writes nothing.
- `/chat` responds before the reflector finishes; a reflector failure leaves the response `200` and is reported once.
- `/chat` without `userId` makes no reflector or memory call.
- `forget_preference` deletes on exactly one clear match and deletes nothing when there is no match, an ambiguous match, another user's match, or no current user.

## Manual scenario

Start the server with `npm run dev`, then:

```bash
# 1. State a durable preference; the answer returns without waiting for learning.
curl -s localhost:3000/chat -X POST -H 'content-type: application/json' -d '{"userId":"u-42","message":"prefiro ver os alertas criticos primeiro"}' | jq -r .answer

# 2. A later turn of the same user should reflect that preference.
curl -s localhost:3000/chat -X POST -H 'content-type: application/json' -d '{"userId":"u-42","message":"como esta o plantao?"}' | jq -r .answer

# 3. A secret must not be learned.
curl -s localhost:3000/chat -X POST -H 'content-type: application/json' -d '{"userId":"u-42","message":"minha senha do painel e hunter2"}' | jq -r .answer

# 4. Ask to forget the preference.
curl -s localhost:3000/chat -X POST -H 'content-type: application/json' -d '{"userId":"u-42","message":"esqueca que prefiro os alertas criticos primeiro"}' | jq -r .answer
```

Learning runs in the background, so allow a moment between steps 1 and 2. Background failures appear on the server's stderr as a single line with the user identifier and the error, never the message text.

For behavior details see [contracts/learning-reflector.md](./contracts/learning-reflector.md), [contracts/forget-preference-tool.md](./contracts/forget-preference-tool.md), and [contracts/chat-http.md](./contracts/chat-http.md). For values and outcomes see [data-model.md](./data-model.md).
