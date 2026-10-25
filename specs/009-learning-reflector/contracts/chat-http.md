# Contract: Chat with Learning Reflection

## Endpoint

`POST /chat` — request and response shapes are unchanged from features 007 and 008. This feature adds no field.

## Added behavior

When the request has a `userId` and a memory store is configured:

1. The selected strategy runs inside the current-user context for that `userId`, so `forget_preference` can act for that user.
2. After the `200` response has been sent, the learning reflector starts in the background with the request's raw `message` and `userId`. See [learning-reflector.md](./learning-reflector.md).

## Unchanged behavior

- Without `userId`: no user context, no reflection, no memory call.
- Non-`200` outcomes (`400`, `404`, `422`, `504`, `500`): no reflection.
- The response body, status, and timing do not depend on the reflector.

## Background failure

A rejected reflector promise is passed to `reportLearningError({ userId, error })`. The default reporter writes one stderr line with the user identifier and the error class and message. It never includes the user message or a candidate fact. The already-sent response is not affected.

## Server options

- `learningReflector?`: replaces the default reflector (tests).
- `reportLearningError?`: replaces the default reporter (tests).

## Required tests

- With `userId`: response is `200` and is received while the reflector is still pending.
- With `userId`: reflector receives the raw message and the user, not the composed prompt.
- Without `userId`: reflector is not called.
- Strategy failure, timeout, and invalid body: reflector is not called.
- Reflector rejection: response is still `200`, reporter is called once with that user.
- End to end with a fake model and deterministic embeddings: a learned fact is recalled on a later turn of the same user and not of another user.
