# Contract: Semantic Memory Store

## Interface

```ts
interface MemoryStore {
  remember(userId: string, fact: string): Promise<{
    memory: Memory;
    inserted: boolean;
  }>;
  recall(userId: string, query: string, k?: number): Promise<Array<{
    memory: Memory;
    score: number;
  }>>;
  forget(userId: string, memoryId: string): boolean;
}
```

Production embedding generation may be asynchronous; `forget` performs only the scoped SQLite delete and reports its result synchronously.

## `remember(userId, fact)`

- `userId` and `fact` are required, trimmed, and non-empty.
- Generate a normalized 384-dimension Float32 embedding locally.
- Compare only candidate memories with the same `user_id`.
- If maximum dot product is strictly greater than `0.92`, return that existing memory with `inserted: false`; do not alter its `fact` or `created_at`.
- Otherwise insert the fact and embedding and return `inserted: true`.
- Invalid model output, corrupt existing BLOB, and SQLite failures are errors, not insertion fallbacks.

## `recall(userId, query)`

- Scope before scoring to exactly one non-empty `userId`.
- Generate one query embedding using the same model and configuration.
- Decode each stored embedding only after verifying it is 1536 bytes and contains 384 finite Float32 values.
- Score by unrounded dot product; include score `>= 0.3`.
- Sort descending by score, with deterministic ties by `created_at` then `id`.
- Filter eligible scores before sorting and applying the requested limit. `k` defaults to three, is capped at three, and may be smaller; return an empty list only when computation succeeded and no records qualify.

## `forget(userId, memoryId)`

- Require non-empty user and memory identifiers.
- Delete with both `id` and `user_id` in the predicate.
- Return `true` when one row was deleted and `false` when none was deleted, including when the identifier belongs to another user.

## Error behavior

Embedding initialization/inference errors, malformed vectors, invalid inputs, and database errors are surfaced to the caller. They must not be converted into a successful empty result or a fabricated embedding.
