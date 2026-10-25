# Contract: Persistent Chat HTTP

## Endpoint

`POST /chat`

Existing strategy selection, reflection, validation, and timeout semantics remain in effect.

## Request

```json
{
  "message": "What changed since the previous alert?",
  "strategy": "react",
  "reflect": false,
  "conversationId": "conversation-uuid"
}
```

- `message`: required, non-empty string.
- `strategy`: optional; retains the existing `react` default and supported values.
- `reflect`: optional boolean; retains the existing default.
- `conversationId`: optional, non-empty string. Omit to create a new conversation; provide a valid existing ID to continue one.
- Unknown fields and malformed values remain invalid requests (HTTP 400).

## Successful response

HTTP `200`:

```json
{
  "answer": "The alert is related to the deployment...",
  "trace": [],
  "metrics": {
    "llmCalls": 1,
    "latencyMs": 5,
    "historyMessages": 4
  },
  "conversationId": "conversation-uuid"
}
```

- Preserve existing `answer`, `trace`, and metrics fields.
- Include `conversationId` on every success, including requests that omitted it.
- `historyMessages` is the number of prior messages composed into the strategy input, from `0` to `12`; it excludes the current request.
- Prior user and assistant entries are role-labelled and chronological; the current request follows them.

## Errors

| Status | Condition | Response |
|---|---|---|
| `400` | Malformed request, including an empty/invalid `conversationId` | Existing invalid-request response with validation issues |
| `404` | Supplied identifier is not an existing conversation | Clear unknown-conversation error; do not create a replacement conversation |
| `422` | Unsupported strategy | Existing unknown-strategy response |
| `504` | Existing request timeout is exceeded | Existing timeout response |
| `500` | Unexpected reasoning or persistence failure | Existing explicit server-error response |

No message pair is persisted if reasoning fails before producing a successful answer. The implementation must append a successful user/assistant pair atomically.
