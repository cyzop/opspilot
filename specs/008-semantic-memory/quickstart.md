# Quickstart: Semantic User Memory

## Prerequisites

- Node.js 22.9 or newer
- OpsPilot dependencies installed
- The dependency set includes `@huggingface/transformers`; install from the committed lockfile with `npm ci`.
- For production inference: provide network access for the first model load or provision `onnx-community/all-MiniLM-L6-v2-ONNX` into the Transformers.js cache before running offline. Embeddings are generated lazily on the first memory operation.

## Validate without downloading a model

Memory-store, vector, and chat tests inject a deterministic embedding function and fake strategy. They must not download model assets or call external providers.

Run the focused tests (all model calls use deterministic injected embeddings; these commands do not download model assets):

```powershell
node --env-file-if-exists=.env --import tsx --test tests/memory/vector.test.ts tests/memory/embeddings.test.ts tests/memory/memory-store.test.ts tests/http/server.test.ts
```

Run project-wide checks:

```powershell
npm test
npm run typecheck
```

Expected outcomes:

- A semantic paraphrase with no shared words recalls the expected saved fact.
- Deduplication occurs only for scores `> 0.92`; recall filters scores `>= 0.3` before ranking and limiting, ranks by dot product, and returns no more than three results (a requested smaller `k` is honored; larger values are capped at three).
- Remember, recall, forget, and chat prompt composition do not expose another user's facts.
- `/chat` without `userId` makes no memory call; `/chat` with `userId` inserts relevant facts before conversation history and the current message.
- `POST /memories` saves a fact (`201`), reuses a near-duplicate (`200`), and the saved fact is recalled by a later `/chat` for the same user only.
- Failed model initialization, inference, invalid vector data, and database access are explicit failures, not empty successful recall.

## Save and recall a fact over HTTP

With the server running (`npm run dev`), save a fact and then ask something related. The first memory call loads the local embedding model, so it may take longer.

```bash
curl -s localhost:3000/memories -X POST -H 'content-type: application/json' -d '{"userId":"u-42","fact":"prefere os alertas criticos primeiro"}' | jq
curl -s localhost:3000/chat -X POST -H 'content-type: application/json' -d '{"userId":"u-42","message":"como devo ordenar os alertas?"}' | jq -r .answer
```

For an offline deployment, download/provision the exact model revision in the runtime's Transformers.js cache during image or host preparation, then run an embedding smoke check as part of deployment validation. Do not replace the model silently: persisted vectors are comparable only when produced by the same model and configuration.

For store operations, see [contracts/memory-store.md](./contracts/memory-store.md). For request/prompt behavior, see [contracts/chat-http.md](./contracts/chat-http.md). For saving facts over HTTP, see [contracts/memories-http.md](./contracts/memories-http.md). For field and vector validation, see [data-model.md](./data-model.md).
