# Contract: Remember a Fact over HTTP

## Endpoint

`POST /memories`

Saves one fact in a user's semantic memory by delegating to `MemoryStore.remember(userId, fact)`. It is the HTTP write path for the facts that `POST /chat` recalls.

## Request

```json
{
  "userId": "u-42",
  "fact": "prefere os alertas criticos primeiro"
}
```

- `userId`: required non-empty string (trimmed). Trusted as identity context under the same assumption as `/chat`; this feature does not add authentication.
- `fact`: required non-empty string (trimmed).
- Unknown fields are rejected.

## Response

- `201 Created` when a new memory is stored.
- `200 OK` when an existing memory of the same user has similarity `> 0.92`; the existing memory is returned unchanged and nothing is inserted.

```json
{
  "id": "memory-uuid",
  "userId": "u-42",
  "fact": "prefere os alertas criticos primeiro",
  "createdAt": "2026-10-13T12:00:00.000Z",
  "inserted": true
}
```

The embedding vector is never included in the response.

## Failure behavior

- `400` with `{ "error": "Invalid request body", "issues": [...] }` for a missing, blank, or unknown field; the store is not called.
- `400` with `{ "error": ... }` when the store rejects the input with a memory validation error.
- `500` with `{ "error": ... }` for embedding or persistence failures, or when no memory store is configured. Failures are never reported as a successful save.

## Out of scope

Listing and forgetting memories over HTTP; `forget` remains a store-level operation.
