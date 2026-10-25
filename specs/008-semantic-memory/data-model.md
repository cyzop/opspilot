# Data Model: Semantic User Memory

## Memory

Represents one fact explicitly saved for a user.

| Field | Storage column | Type and validation |
|---|---|---|
| `id` | `id` | Non-empty stable identifier; primary key. |
| `userId` | `user_id` | Non-empty user identifier; required. Every operation scopes by this value. |
| `fact` | `fact` | Trimmed, non-empty text. |
| `embedding` | `embedding` | Required BLOB of exactly 1536 bytes, encoding 384 finite Float32 values in the selected model's normalized vector representation. |
| `createdAt` | `created_at` | Required ISO-8601 timestamp. |

The `memories` table contains exactly the requested columns: `id`, `user_id`, `fact`, `embedding`, and `created_at`. An index on `(user_id, created_at, id)` can support scoped iteration and deterministic ordering without exposing other users' data.

## Embedding

- Model identity: `onnx-community/all-MiniLM-L6-v2-ONNX`, representing all-MiniLM-L6-v2 for Transformers.js.
- Pipeline task: feature extraction.
- Pooling: mean.
- Normalization: L2 normalization enabled.
- Dimension: 384 Float32 values; one vector occupies 1536 bytes.
- Validate dimension, finite numeric values, and normalized output before storage/comparison.
- Store/query vectors from the same model identity; do not mix embedding spaces.

## Recall result

| Field | Type and validation |
|---|---|
| `memory` | Validated `Memory` owned by the requested user. |
| `score` | Finite unrounded dot product of normalized vectors. |

- Scope candidates to one `user_id` before decoding/scoring embeddings.
- Exclude scores below `0.3`; score exactly `0.3` is eligible.
- Sort by score descending, then `created_at`, then `id` for deterministic ties.
- Return at most three results.

## Store operations and state

- `remember(userId, fact)`: validate both inputs, embed the fact, compare only this user's vectors, return the existing memory when best score is strictly greater than `0.92`; otherwise insert a new row.
- `recall(userId, query)`: validate and embed the query, scan only this user's records, validate each BLOB, score, filter, sort, and return at most three.
- `forget(userId, memoryId)`: delete by both `user_id` and `id`; return whether exactly one row was removed.
- A missing or foreign-owned ID is reported as not deleted and must not disclose another user's record.
- Model, vector, and persistence errors propagate; they are never converted to an empty recall.

## Chat request integration

- `userId` is optional on `/chat`; when absent, no memory lookup occurs.
- With `userId`, add non-empty recall results before existing conversation history and the current user message.
- Memory content must be included only from the user ID used for that request.
