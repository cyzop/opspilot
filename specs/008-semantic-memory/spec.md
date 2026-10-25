# Feature Specification: Semantic User Memory

**Feature Branch**: `008-semantic-memory`

**Created**: 2026-10-12

**Status**: Draft

**Input**: User description: "Memória semântica: MemoryStore por userId - remember (dedup > 0.92), recall top-3 por produto escalar (min 0.3), forget; tabela memories, embedding all-MiniLM-L6-v2 local em BLOB; /chat ganha userId e injeta o recall no prompt; teste: recall acha fato sem palavra em comum. user: @huggingface/transformes com pooling: mean + normalize: true e lazy singleton src/memory/embeddings.ts e src/memory/memory-store.ts As colunas de memories (id, user_id, fact, embedding, created_at)"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Remember and manage personal facts (Priority: P1)

As an OpsPilot user, I want to save useful facts in my own memory and remove facts that are no longer relevant so that future conversations can use information I have explicitly retained.

**Why this priority**: Persistent, user-scoped facts are the foundation for all future semantic recall.

**Independent Test**: Save a fact for one user, verify it is returned as an existing fact instead of duplicated when a sufficiently similar fact is saved again, and verify it can be removed without affecting another user's facts.

**Acceptance Scenarios**:

1. **Given** a user with no matching saved fact, **When** the user saves a fact, **Then** it is stored under that user's identity with its semantic representation and creation time.
2. **Given** the same user already has a fact with similarity greater than `0.92`, **When** a near-duplicate is saved, **Then** the existing fact is reused and no duplicate record is created.
3. **Given** a saved fact belonging to a user, **When** that user forgets the fact by its identifier, **Then** the fact is removed and cannot be recalled afterward.
4. **Given** facts saved for different users, **When** one user saves, recalls, or forgets a fact, **Then** no other user's facts are changed or returned.
5. **Given** a running chat server, **When** a client posts a `userId` and `fact` to `/memories`, **Then** the fact is saved for that user, the response states whether it was inserted or reused, and a later `/chat` request with the same `userId` can recall it.

### User Story 2 - Recall relevant facts by meaning (Priority: P1)

As an OpsPilot user, I want to retrieve saved facts that are semantically relevant to a question even when they use different words so that memory helps with paraphrases and implicit context.

**Why this priority**: Semantic retrieval distinguishes this feature from simple text search and makes saved facts useful during natural conversations.

**Independent Test**: Save a fact about a user's preferred time for incident maintenance and query using a paraphrase about when operational changes should happen that shares no meaningful words with the saved fact; verify the fact is recalled if its semantic score meets the minimum threshold.

**Acceptance Scenarios**:

1. **Given** relevant facts saved for a user, **When** the user asks a semantically related question, **Then** recall returns the three highest-scoring eligible facts, or fewer when fewer qualify.
2. **Given** a saved fact whose relevance score is below `0.3`, **When** the user recalls facts, **Then** that fact is excluded.
3. **Given** a fact for a different user that is more relevant to the query, **When** recall is requested, **Then** the other user's fact is never returned.
4. **Given** a query with no eligible facts, **When** recall is requested, **Then** it returns an empty list rather than unrelated memories.

### User Story 3 - Use recalled facts in chat (Priority: P1)

As an OpsPilot user, I want chat answers to take my relevant saved facts into account so that I do not need to repeat personal or operational preferences in each conversation.

**Why this priority**: Connecting recall to chat turns stored facts into useful context at the point of need.

**Independent Test**: Submit a chat request with a user identifier and a query that semantically matches a saved fact but shares no meaningful words with it; with a deterministic fake strategy, verify the recalled fact is present in the strategy input and the correct user's memory is used.

**Acceptance Scenarios**:

1. **Given** a user identifier and one or more relevant saved facts, **When** the user submits a chat request, **Then** eligible recalled facts are added to the prompt before the current request.
2. **Given** no eligible memories for the user, **When** the user submits a chat request, **Then** the strategy receives the existing chat prompt without an empty or fabricated memory section.
3. **Given** a chat request without a user identifier, **When** the existing chat flow is invoked, **Then** it continues without memory lookup and preserves prior chat behavior.
4. **Given** a request carrying one user's identifier, **When** the prompt is composed, **Then** it contains no facts belonging to a different user.

### Edge Cases

- A blank, malformed, or missing user identifier is supplied to a memory operation.
- A blank fact or recall query is supplied.
- A memory is exactly at the deduplication threshold `0.92`; it is not a duplicate because the rule is strictly greater than `0.92`.
- A recalled fact is exactly at score `0.3`; it is eligible because the minimum is inclusive.
- More than three eligible facts have the same score around the top-three cutoff.
- The embedding model cannot be loaded locally, returns an invalid vector, or returns a vector with an unexpected dimension.
- The stored embedding BLOB is malformed or has a dimension different from a query embedding.
- A user attempts to forget an identifier owned by another user or one that does not exist.
- Chat runs without `userId`, with an empty recall result, or when embedding generation fails.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide a memory store with `remember`, `recall`, and `forget` operations scoped to a required `userId`.
- **FR-002**: The system MUST persist each memory with the fields `id`, `user_id`, `fact`, `embedding`, and `created_at`.
- **FR-003**: The system MUST generate fact and query embeddings locally using the `all-MiniLM-L6-v2` model with mean pooling and vector normalization enabled, initialized on first use and reused as a lazy singleton.
- **FR-004**: The system MUST store embeddings as a binary large object and MUST reject invalid or dimension-incompatible vectors instead of silently substituting a representation.
- **FR-005**: When a user remembers a fact, the system MUST compare its embedding only with that same user's saved memories and MUST avoid creating a duplicate only when similarity is strictly greater than `0.92`.
- **FR-006**: The `remember` operation MUST preserve the existing matching memory on deduplication and MUST return an explicit outcome distinguishing insertion from reuse.
- **FR-007**: The `recall` operation MUST rank only the requesting user's memories by the dot product of normalized embeddings, return no more than the top three, and include only memories with score greater than or equal to `0.3`.
- **FR-008**: The `forget` operation MUST delete only the memory with the requested identifier belonging to the requesting `userId` and MUST explicitly report whether a record was deleted.
- **FR-009**: The `/chat` request MUST accept an optional `userId`; omission MUST preserve the existing chat behavior without semantic-memory lookup.
- **FR-010**: When `userId` is provided, `/chat` MUST recall relevant facts for that user and inject them into the strategy prompt before the current user message.
- **FR-011**: When recall returns no eligible facts, `/chat` MUST NOT add an empty memory section or fabricate memory content.
- **FR-012**: The system MUST never include or modify memories belonging to a different user in remember, recall, forget, or chat prompt composition.
- **FR-013**: The system MUST surface model-loading, embedding, persistence, and validation failures explicitly; it MUST NOT treat failed recall as a successful empty result.
- **FR-014**: Tests MUST verify user isolation, strict deduplication and recall thresholds, top-three ordering, forget behavior, lazy model initialization, and chat prompt injection.
- **FR-015**: A deterministic semantic-recall test MUST retrieve a relevant fact for a query with no meaningful words in common with the fact, without using an external model provider or network at test runtime.

- **FR-016**: The HTTP server MUST expose `POST /memories` accepting exactly a required `userId` and `fact`, saving the fact through the `remember` operation, and returning the saved memory without its embedding together with the insertion-versus-reuse outcome (`201` when inserted, `200` when an existing memory is reused).
- **FR-017**: `POST /memories` MUST reject missing, blank, or unknown fields with an invalid-request response without saving anything, and MUST surface embedding and persistence failures as explicit server failures.

### Key Entities

- **Memory**: A user-owned fact with a stable identifier, semantic representation, and creation time.
- **User**: The identifier that scopes all memory creation, retrieval, and deletion operations.
- **Embedding**: A normalized numeric vector representing a fact or query in a shared semantic space.
- **Recall result**: A memory fact and its relevance score, ordered from most to least relevant and limited to three results.
- **Chat request**: An existing OpsPilot chat message optionally associated with a user whose eligible memories can inform the prompt.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of remembered facts are isolated by user; no recall or deletion operation returns or changes another user's records.
- **SC-002**: Duplicate facts are reused exactly when their similarity is greater than `0.92`, while facts at or below that threshold remain independently storable.
- **SC-003**: Recall returns at most three facts, all with scores of at least `0.3`, in descending score order.
- **SC-004**: The semantic-recall acceptance test retrieves the expected fact for a paraphrased query with no meaningful words in common with the saved fact.
- **SC-005**: 100% of chat requests with a user identifier include eligible recalled facts in the strategy context, while requests without an identifier preserve the current behavior.
- **SC-006**: The embedding model is initialized no earlier than its first embedding request and reused for subsequent requests in the same process; failed initialization can be retried without restarting the service.

## Assumptions

- `userId` is optional on `/chat` to preserve existing callers and required for direct memory operations.
- In this feature, a valid client-supplied `userId` is treated as trusted identity context; authentication and authorization of that identifier are out of scope. The HTTP deployment must supply or constrain this value according to its trust boundary.
- `forget(userId, memoryId)` forgets one specific memory; bulk deletion and natural-language extraction of facts from chat are out of scope.
- `POST /memories` is the only HTTP write path for memories; listing and forgetting memories over HTTP are out of scope.
- Deduplication returns the existing fact without replacing its text or creation time.
- Recall is scoped to one user, uses normalized vector dot products, applies the inclusive minimum score of `0.3`, and breaks equal-score ties deterministically by memory creation time and identifier.
- When chat includes both persisted conversation history and recalled memories, the memory section precedes conversation history, which precedes the current request.
- Embeddings are generated with the locally available `@huggingface/transformers` package and are not fetched from an external service during normal requests.
- On first use, the package may download model assets from the Hugging Face Hub; deployments operating offline provision those assets before serving requests.
- Automated semantic-recall tests use deterministic embeddings or a checked-in fixture and do not download a model or call a provider at test runtime.
