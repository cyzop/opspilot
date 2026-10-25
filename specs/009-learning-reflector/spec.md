# Feature Specification: Learning Reflector

**Feature Branch**: `009-learning-reflector`

**Created**: 2026-10-12

**Status**: Draft

**Input**: User description: "Refletor de aprendizado: após cada resposta, um withStructuredOutput({ hasLearning, fact }) lê a última mensagem do usuário e destila fatos duráveis (nunca pedido pontual, nunca segredo) -> memories.remember assíncrono; tool forget_preference"

## User Scenarios & Testing

### User Story 1 - Remember durable user context (Priority: P1)

As a returning OpsPilot user, I want the assistant to remember durable preferences and facts I share so that later answers can take that context into account without me repeating it.

**Why this priority**: Durable, relevant context is the core value of the learning reflector and builds on the existing per-user semantic memory.

**Independent Test**: Submit a successful chat turn with a user identity and a durable preference, verify the response is returned without waiting for reflection, and verify that the preference is subsequently available only to that same user.

**Acceptance Scenarios**:

1. **Given** a successful chat turn with a user identity and a durable preference in the latest user message, **When** the assistant has returned its response, **Then** the reflector produces one validated learning candidate and asynchronously asks the user's memory to remember it.
2. **Given** the reflector determines that a durable fact is present, **When** it returns its structured result, **Then** the fact is trimmed, non-empty, scoped to the current user, and eligible for the existing memory store's deduplication behavior.
3. **Given** a chat request without a user identity, **When** the assistant responds, **Then** no learning reflection or memory write is performed.

### User Story 2 - Avoid storing transient or sensitive content (Priority: P1)

As a user, I want the assistant to avoid saving one-time requests and secrets so that persistent memory contains only safe context that remains useful later.

**Why this priority**: Learning is only trustworthy if transient instructions and sensitive values are excluded before they can be persisted.

**Independent Test**: Submit examples of a one-off request, temporary incident detail, credential, token, and durable non-sensitive preference; verify that only the durable safe preference is passed to memory.

**Acceptance Scenarios**:

1. **Given** the latest user message is only a one-time request or describes transient state, **When** reflection completes, **Then** `hasLearning` is false and no memory write is attempted.
2. **Given** the latest user message includes a password, access token, API key, private key, or other recognizable credential, **When** reflection completes, **Then** the candidate is rejected and no secret or derived fact is written to memory.
3. **Given** a message contains both a safe durable preference and a secret, **When** reflection completes, **Then** the entire candidate is rejected unless a safe fact can be independently extracted without retaining, paraphrasing, or referring to the secret.

### User Story 3 - Forget a learned preference (Priority: P2)

As a user, I want to tell OpsPilot to forget a learned preference so that I can remove persistent context that is no longer correct or wanted.

**Why this priority**: Users need a direct, understandable way to control and revoke learned information.

**Independent Test**: Ask OpsPilot to forget one previously learned preference; verify the matching memory for the current user is removed and is no longer returned by later recall.

**Acceptance Scenarios**:

1. **Given** exactly one learned preference matches the user's forget request, **When** `forget_preference` is invoked for that user, **Then** only that user's matching memory is removed and the tool reports success.
2. **Given** no preference matches, **When** `forget_preference` is invoked, **Then** no memory is deleted and the tool reports that nothing was removed.
3. **Given** multiple preferences could match the request, **When** `forget_preference` is invoked, **Then** it removes none and identifies that the user must clarify which preference to forget.
4. **Given** a preference belongs to another user, **When** a user invokes `forget_preference`, **Then** the other user's memory remains unchanged and its content is not disclosed.

### Edge Cases

- The latest user message is empty, missing, or cannot be safely interpreted; reflection produces no memory write.
- Structured reflection output is malformed, missing a fact when `hasLearning` is true, or includes a fact when `hasLearning` is false; the output is rejected and no write occurs.
- The reflection model or memory store fails after the assistant response has been delivered; the successful response remains successful, while the background failure is reported through the application's established operational error reporting and is not silently discarded.
- Two equivalent durable facts arrive in separate turns; the existing memory deduplication rules prevent unnecessary duplicate records.
- A forget request is ambiguous or targets another user's data; no destructive action is taken.
- A user sends consecutive turns while earlier learning is still running; each reflection uses only its own turn's latest user message and user identity.

## Requirements

### Functional Requirements

- **FR-001**: After each successful assistant response for a request with a user identity, the system MUST evaluate only the latest user message from that request for durable user-specific learning.
- **FR-002**: The system MUST return the assistant response without waiting for reflection or memory persistence to finish.
- **FR-003**: The reflection MUST return a structured result with a boolean `hasLearning` and a `fact` that is a non-empty string when learning is present and absent or empty when no learning is present.
- **FR-004**: The system MUST persist a candidate only when `hasLearning` is true and its fact is validated as trimmed, non-empty, safe, and durable.
- **FR-005**: The system MUST treat a durable fact as a user-specific preference or stable context likely to remain useful across future conversations; it MUST NOT learn one-time requests, temporary instructions, transient incidents, or ephemeral state.
- **FR-006**: The system MUST NOT persist credentials, authentication tokens, API keys, private keys, or facts that reveal or reproduce such secrets. If safety cannot be established, the system MUST reject the candidate.
- **FR-007**: The system MUST associate all learned facts with the same user identity as the chat turn and MUST NOT learn or recall a fact across users.
- **FR-008**: The system MUST pass accepted facts to the existing memory store's `remember` operation and preserve its established deduplication and validation behavior.
- **FR-009**: When no user identity is supplied, the system MUST skip reflection and learning without changing existing chat response behavior.
- **FR-010**: The system MUST report asynchronous reflection or memory persistence failures through established operational error reporting without changing an already delivered successful response or silently treating the failure as a successful write.
- **FR-011**: The assistant MUST expose a `forget_preference` tool that acts only for the current user identity and removes a matching learned preference without exposing another user's records.
- **FR-012**: `forget_preference` MUST remove a preference only when the request identifies exactly one matching memory. When there is no match, it MUST report no deletion; when multiple matches are plausible, it MUST delete none and request clarification.
- **FR-013**: The system MUST validate structured reflection and tool inputs and outputs at their boundaries and reject malformed values before any memory mutation.

### Explicit Integration Constraints

- The reflector MUST use structured model output equivalent to `withStructuredOutput({ hasLearning, fact })`.
- The learning operation MUST call the existing `memories.remember` capability asynchronously after the assistant response.
- The forget capability MUST be exposed to the assistant under the tool name `forget_preference`.

### Key Entities

- **Learning Candidate**: The result of evaluating the latest user message; contains whether a durable fact exists and, when present, the safe fact text.
- **Learned Memory**: A durable, non-sensitive user-specific fact stored for later semantic recall.
- **Forget Request**: A user's request identifying one learned preference to remove; may resolve to one match, no match, or an ambiguous set.

## Success Criteria

### Measurable Outcomes

- **SC-001**: In tests for successful chat turns with a user identity, 100% of eligible durable facts are submitted to memory and 0% of one-time requests or transient facts are submitted.
- **SC-002**: In the defined secret test set (passwords, API keys, access tokens, and private keys), 100% of candidates containing a recognizable secret are rejected before persistence.
- **SC-003**: A completed chat response is delivered without waiting for reflection or memory persistence; reflection failure does not turn a successful response into a failed response.
- **SC-004**: In forget-tool tests, 100% of unique matches for the current user are removed, while 100% of ambiguous, missing, and other-user matches result in zero deletions.
- **SC-005**: Existing chat requests without a user identity continue to complete without reflection or memory calls.

## Assumptions

- A request's supplied user identity is the identity context used by the existing semantic-memory feature; authentication and authorization remain deployment responsibilities.
- Only successful assistant responses trigger reflection; failed validation, strategy failures, and timed-out responses do not.
- “Durable learning” is limited to stable user preferences and reusable context, not automatic extraction of incident records or operational facts.
- The forget tool receives a natural-language description of the preference from the user and resolves it only if exactly one current-user memory is a clear match; it does not expose internal memory identifiers.
- Reflection and persistence failures after response delivery are observable operational errors, but do not retract or delay the response.
- Secret detection is conservative: uncertain candidates are rejected rather than persisted.
