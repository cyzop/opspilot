# Contract: Chat with Semantic Memory

## Endpoint

`POST /chat`

## Request

The existing `/chat` request accepts one additional optional field:

```json
{
  "message": "When should we schedule the deployment?",
  "userId": "user-123",
  "conversationId": "conversation-uuid",
  "strategy": "react",
  "reflect": false
}
```

- `userId`: optional non-empty string. If omitted, memory is not consulted and existing request behavior is preserved.
- Existing `message`, `conversationId`, `strategy`, and `reflect` validation/semantics remain unchanged.
- A supplied `userId` is trusted as the identity context for this scope. The deployment is responsible for authenticating or constraining its source; this feature does not add authentication.

## Prompt composition

When `userId` is present, recall that user's top-three facts with score `>= 0.3`.

- If recall returns facts, include them as a clearly labelled semantic-memory context section before the existing conversation history and current user message.
- If recall returns no eligible facts, do not include an empty memory section.
- Never include facts from another user.
- Embedding or store failures are surfaced as request failures; they are not treated as empty recall.

## Response

The existing successful response shape is preserved, including conversation ID and history metrics from persistent-chat behavior. Semantic memory does not add a response field in this feature.

## Failure behavior

Existing HTTP validation, unknown-strategy, timeout, and server-error handling remains in effect. Memory input validation errors follow the invalid-request response. Embedding and persistence failures return an explicit server failure and do not fabricate a result.
