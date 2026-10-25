# Contract: Learning Reflector

## Operation

`reflectUserLearning({ userId, message, memoryStore, model? })` → `Promise<LearningOutcome>`

Located in `src/memory/learning-reflector.ts`. Outcome variants are defined in [data-model.md](../data-model.md).

## Behavior

1. Trim `userId` and `message`. If either is empty, return `{ learned: false, reason: "empty_input" }` without calling the model.
2. Call the model once with structured output for `{ hasLearning, fact }`. The prompt contains only the latest user message, never history or recalled facts.
3. Re-validate the model output. Malformed output throws `LearningValidationError`.
4. If `hasLearning` is false, return `{ learned: false, reason: "no_learning" }`.
5. Apply the fact safety rule to the fact and the message. On rejection return `{ learned: false, reason }`.
6. Call `memoryStore.remember(userId, fact)` with the cleaned fact and return `{ learned: true, inserted }`.

## Guarantees

- `remember` is called at most once, only in step 6, and only with the `userId` passed in.
- No step writes the message or the fact to a log.
- Model and store errors propagate to the caller; they are never converted into a "not learned" outcome.

## Required tests

- Durable preference → one `remember` call with the trimmed fact and the same user.
- Blank user or blank message → no model call, no write.
- `hasLearning: false` → no write.
- Malformed output (`true` with empty fact, `false` with a fact, unknown field) → `LearningValidationError`, no write.
- Secret set (password, API key, access token, private key, key-shaped values) → rejected with `secret`, no write.
- Safe preference returned alongside a secret in the fact → rejected.
- Message containing a secret-shaped value with a clean, unrelated fact → accepted.
- One-time request, question, temporary state, forget request, in English and Portuguese → rejected with `transient`.
- A durable preference written in Portuguese → accepted.
- Model failure and store failure → rejection propagates.
