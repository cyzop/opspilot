# Quickstart: Persistent Chat Conversations

## Prerequisites

- Node.js 22.9 or newer
- OpsPilot dependencies installed

## Validate the store and HTTP behavior

The feature tests inject `SqliteConversationStore(":memory:")` and the deterministic `FakeReasoningStrategy` from `tests/helpers/fake-reasoning-strategy.ts`; they must not contact a model provider or network service. A separate temporary-file scenario verifies persistence after reopening the database.

Run the focused tests:

```powershell
node --env-file-if-exists=.env --import tsx --test tests/store/sqlite-conversation-store.test.ts tests/http/server.test.ts
```

Run the complete required checks:

```powershell
npm test
npm run typecheck
```

Expected outcomes:

- A request without `conversationId` succeeds with a new ID and stores user and assistant messages in order.
- A follow-up with that ID reuses the conversation, passes at most 12 prior messages to the fake strategy, and reports their exact count in `metrics.historyMessages`.
- Unknown IDs return HTTP 404; invalid input retains HTTP 400 behavior.
- Strategy failures do not leave partial message pairs.
- Each user/assistant pair is stored in order and atomically; if insertion of the assistant message fails, neither message remains.

For request/response details, see [contracts/chat-http.md](./contracts/chat-http.md). For persistence and ordering rules, see [data-model.md](./data-model.md).
