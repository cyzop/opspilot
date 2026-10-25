# Feature Specification: Persistent Chat Conversations

**Feature Branch**: `007-persistent-chat`

**Created**: 2026-10-12

**Status**: Draft

**Input**: User description: "Conversa persistente:
- ConversationStore (append/lastMessages/create) + tabela messages como no SqliteOpsStore
- /chat: conversationid opcional, devolvido na resposta
- 12 últimas mensagens no prompt via composição; métricas historyMessages
- testes ':memory:' + fake"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Continue a persistent conversation (Priority: P1)

As an OpsPilot operator, I want to continue a previous chat by sending its conversation identifier so that the system can retain context across separate requests and server restarts.

**Why this priority**: Conversation continuity is the core value of this feature; without it, stored messages cannot support follow-up questions.

**Independent Test**: Submit two successful requests using the same identifier with a deterministic fake strategy, restart the service against the same persistent store, and verify that the identifier remains usable and both turns are available in order.

**Acceptance Scenarios**:

1. **Given** a valid chat request without a conversation identifier, **When** the operator submits it, **Then** the system creates a conversation, persists the successful user and assistant messages, and returns its `conversationId`.
2. **Given** an existing conversation identifier, **When** the operator submits a follow-up request, **Then** the system adds the successful turn to that conversation and returns the same `conversationId`.
3. **Given** an identifier that does not identify an existing conversation, **When** the operator submits it, **Then** the system returns a clear not-found response and does not silently create a different conversation.

### User Story 2 - Receive answers informed by recent conversation history (Priority: P1)

As an OpsPilot operator, I want follow-up questions to include recent messages from the same conversation so that I do not need to repeat operational context.

**Why this priority**: Recent context is what makes persistent conversations useful for incident analysis and follow-up questions.

**Independent Test**: Use a fake strategy that captures the composed prompt and verify that it contains only the most recent 12 prior messages in chronological order, followed by the new user message.

**Acceptance Scenarios**:

1. **Given** a conversation with fewer than 12 prior messages, **When** a new request is processed, **Then** all prior messages are included before the new user message.
2. **Given** a conversation with more than 12 prior messages, **When** a new request is processed, **Then** only the latest 12 prior messages are included in chronological order.
3. **Given** a successful request, **When** the response is returned, **Then** `metrics.historyMessages` reports the number of prior messages included, from 0 through 12, excluding the current request.

### User Story 3 - Verify conversation behavior without external services (Priority: P2)

As a developer, I want to exercise persistence and context composition using an isolated in-memory store and a fake strategy so that tests are deterministic and do not require model-provider access or network calls.

**Why this priority**: Reliable local verification prevents regressions in persistence and prompt context without depending on external services.

**Independent Test**: Run the conversation and chat integration tests with an in-memory database and fake strategy, then verify created identifiers, stored messages, composed history, and returned metrics.

**Acceptance Scenarios**:

1. **Given** an in-memory database and fake strategy, **When** a successful chat request is submitted, **Then** the test can assert its response, persisted messages, and history metric without external network access.
2. **Given** an invalid conversation identifier or malformed request, **When** the endpoint handles it, **Then** it returns a clear error and does not persist a partial message pair.

### Edge Cases

- The optional conversation identifier is blank or has an invalid type.
- A supplied conversation identifier does not exist.
- A conversation has no history, fewer than 12 messages, exactly 12 messages, or more than 12 messages.
- The strategy fails or times out after a conversation has been selected.
- The service is restarted between turns while using the same persistent store.
- Stored history is returned in a different order than it was created.
- A new conversation request fails before a complete assistant response is produced.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The chat endpoint MUST accept an optional `conversationId` in addition to the existing chat request fields.
- **FR-002**: When `conversationId` is omitted, the system MUST create a new conversation and include its identifier as `conversationId` in every successful response.
- **FR-003**: When an existing `conversationId` is supplied, the system MUST use that conversation and return the same identifier in the successful response.
- **FR-004**: The system MUST reject an unknown conversation identifier with a clear not-found error and MUST NOT silently substitute or create another conversation.
- **FR-005**: The system MUST persist each successful exchange as an ordered user message followed by its assistant response, associated with the conversation identifier.
- **FR-006**: The system MUST provide a conversation store contract with operations to create a conversation, append a message, and retrieve the latest messages for a conversation.
- **FR-007**: The persistent conversation store MUST retain conversation and message data across service restarts and MUST record messages in a `messages` table following the existing OpsPilot SQLite store conventions.
- **FR-008**: Before processing a follow-up request, the system MUST compose the strategy input from the latest 12 prior messages in that conversation, ordered oldest to newest, followed by the current user message.
- **FR-009**: The first request in a conversation MUST have no prior history; its strategy input MUST contain the current user message only.
- **FR-010**: Every successful chat response MUST preserve the existing answer, trace, and metrics fields and include the conversation identifier.
- **FR-011**: The metrics object MUST include `historyMessages`, a non-negative integer reporting the count of prior messages composed into the strategy input, excluding the current user message and capped at 12.
- **FR-012**: The system MUST avoid persisting a partial exchange when strategy execution fails before an assistant response is produced.
- **FR-013**: Tests MUST verify store and endpoint behavior using an in-memory database and a deterministic fake strategy without external model-provider or network access.

### Key Entities

- **Conversation**: A persistent chat thread identified by a stable identifier and containing an ordered sequence of messages.
- **Message**: A user or assistant entry associated with one conversation and an ordering position; its content contributes to later context when within the 12-message window.
- **Conversation store**: The persistence boundary that creates conversations, appends messages, and retrieves recent messages in their original order.
- **Chat response**: The existing answer, trace, and metrics result extended with the conversation identifier and the count of history messages used.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of successful first-turn requests return a stable `conversationId` and persist both user and assistant messages in order.
- **SC-002**: 100% of follow-up requests using a valid identifier reuse that conversation and include its prior messages in the strategy input.
- **SC-003**: For every request, the strategy receives no more than 12 prior messages, in chronological order, and `historyMessages` exactly equals the number included.
- **SC-004**: 100% of successful responses preserve the existing answer, trace, and metrics fields while also returning the conversation identifier and history count.
- **SC-005**: 100% of conversation acceptance scenarios can be verified repeatably without requiring access to external services.
- **SC-006**: Conversation and message history remains available after a service restart when the same persistent store is reopened.

## Assumptions

- The public JSON property is named `conversationId` in camel case, consistent with the existing API's naming style.
- The 12-message limit counts prior user and assistant messages individually; the current request is added after this history window.
- The system creates a new conversation for a request without an identifier, but stores the user/assistant pair only after a successful answer is produced.
- Existing chat error semantics remain unchanged except that an unknown conversation identifier receives a clear not-found response.
- Conversation retention is indefinite in this feature; deletion, expiry, ownership, and multi-user access control are out of scope.
- The SQLite implementation and isolated `:memory:` test mode follow existing OpsPilot store conventions.
