# Data Model: Persistent Chat Conversations

## Conversation

Represents one persistent chat thread.

| Field | Type | Rules |
|---|---|---|
| `id` | string | Required, non-empty, stable, unique identifier. Generated when a request omits `conversationId`. |
| `createdAt` | ISO-8601 timestamp | Required, set once when the conversation is created. |

### Relationships and lifecycle

- A conversation has zero or more messages.
- New requests without an identifier create a conversation before reasoning starts.
- Requests with an identifier must resolve to an existing conversation; otherwise report an unknown-conversation domain error.
- A strategy failure may leave an empty conversation but must not leave a partial exchange.

## Message

Represents one user or assistant entry in a conversation.

| Field | Type | Rules |
|---|---|---|
| `id` | integer | Required, unique, monotonically increasing insertion order. |
| `conversationId` | string | Required foreign key to a conversation. |
| `role` | enum | Exactly `user` or `assistant`. |
| `content` | string | Required, non-empty, trimmed/validated at the boundary. |
| `createdAt` | ISO-8601 timestamp | Required. Ordering uses `id`, not timestamp. |

### Persistence and validation

- A `messages` table stores individual messages; a `conversations` table stores identifiers and creation times.
- Enforce the conversation relationship with a foreign key and enable/verify SQLite foreign-key enforcement on every connection before transactions.
- `ConversationStore.create` creates and returns a validated conversation identifier.
- `ConversationStore.append` accepts an ordered pair for a single successful exchange and commits both messages atomically.
- `ConversationStore.lastMessages(conversationId, limit)` validates a positive integer limit and returns no more than that many messages in chronological order, even if the database query fetches newest rows first. Bind the limit as a query parameter.
- The request composition limit is exactly 12 prior messages; current input is excluded from `historyMessages`.
- A successful chat response validates `historyMessages` as a non-negative integer and returns its conversation ID.
- An index beginning with `(conversation_id, id)` supports recent-message retrieval.

## Chat exchange

An exchange comprises the current user request and its assistant answer. For successful strategy execution, persist the user entry followed by the assistant entry inside one short transaction; do not hold a write transaction open during strategy/model execution. Strategy errors/timeouts do not persist either entry. The assistant answer, existing trace, and other metrics retain current semantics; the new `historyMessages` metric equals the count of prior entries included in the composed prompt.
