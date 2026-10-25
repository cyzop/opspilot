# Research: Persistent Chat Conversations

## Decision 1: Keep conversation persistence behind a dedicated store

**Decision**: Add a `ConversationStore` with `create`, `append`, and `lastMessages` operations, separate from the existing operational `OpsStore`.

**Rationale**: Conversations and messages are a distinct domain from incidents, alerts, and runbooks. The existing code already isolates SQLite access behind store contracts, and a separate store keeps HTTP and reasoning code independent of persistence details.

**Alternatives considered**:
- Add conversation-specific methods to `OpsStore`: rejected because this couples unrelated operational data and chat history lifecycles.
- Query SQLite directly from the HTTP handler: rejected because it mixes controller and persistence responsibilities and makes deterministic fake-store tests harder.

## Decision 2: Persist a conversation record and an ordered message table

**Decision**: Use a `conversations` table for stable identifiers and existence checks, plus a `messages` table with conversation foreign key, role, content, and monotonically ordered message key. Fetch the newest requested window in descending order and reverse it before returning. Enable and verify SQLite foreign-key enforcement for each database connection; validate the requested limit as a positive integer and bind it as a query parameter.

**Rationale**: A conversation may exist before a successful first response, and a conversation table makes an unknown ID distinguishable from a valid conversation with no messages. An explicit message ordering key guarantees chronology even when timestamps match. A foreign key provides an integrity check at the database boundary, while an explicit lookup can provide a friendly not-found response. SQLite foreign-key enforcement is disabled by default and must be enabled per connection. An index starting with `(conversation_id, id)` supports retrieval of the recent window. Existing SQLite initialization conventions are reused.

**Alternatives considered**:
- Infer conversation existence from rows in `messages`: rejected because empty conversations cannot be represented or validated.
- Use timestamps alone for order: rejected because timestamps can collide.
- Store the complete transcript as one serialized document: rejected because it makes bounded retrieval and atomic ordered appends more fragile.
- Rely only on a pre-insert existence lookup: rejected because database foreign-key enforcement remains the integrity guarantee if state changes between lookup and insert.

## Decision 3: Append each successful exchange atomically after reasoning completes

**Decision**: Run reasoning with the fetched history and current message first. On success, persist the current user message and assistant answer together in one short explicit store transaction. A strategy error or timeout therefore does not leave a partial exchange, and the transaction never spans model/network execution.

**Rationale**: Matches the feature's explicit no-partial-pair requirement and avoids representing an unanswered user turn as a completed exchange. SQLite transactions make the pair all-or-nothing; SQLite allows only one simultaneous writer, so database-busy failures should follow the existing driver's explicit failure behavior rather than being silently ignored. Conversation creation remains separate, so a failed first request may leave an empty conversation, but no messages are stored.

**Alternatives considered**:
- Persist the user message before invoking the strategy: rejected because failure would leave a partial exchange.
- Append both messages as separate store calls: rejected because failure between calls could persist only one side.

**Reference**: [SQLite transactions](https://www.sqlite.org/lang_transaction.html).

## Decision 4: Compose recent history as role-labelled text for the existing strategy interface

**Decision**: Read up to 12 prior messages, preserve chronological order and role labels in a deterministic text composition, then append the current user message. Report the number of prior messages included as `metrics.historyMessages`.

**Rationale**: Existing strategies accept a single string, so a deterministic role-labelled transcript works without changing strategy interfaces. The history cap counts individual messages, not turns, and excludes the current message.

**Alternatives considered**:
- Change every strategy to accept structured chat messages: rejected for this feature because it expands scope beyond the existing `run(input: string)` contract.
- Pass history without role labels: rejected because the model could not reliably distinguish operator requests from assistant responses.

**Reference**: [SQLite SELECT](https://www.sqlite.org/lang_select.html) describes query ordering; a stable sequence key selects the window and application-side reversal restores chronological order.

## Decision 5: Reuse current validation and test conventions

**Decision**: Validate request, store records, and response metrics with the existing Zod convention; cover the SQLite store with `:memory:` and HTTP behavior with a deterministic fake strategy using `node:test`.

**Rationale**: These are project requirements from the constitution and existing test suites, and do not introduce dependencies or external service calls.

**Alternatives considered**:
- Use provider-backed integration tests: rejected because they are nondeterministic and require network credentials.
- Add another persistence or HTTP framework: rejected because the project already has the needed SQLite and Express infrastructure.

**References**: [Node.js SQLite documentation](https://nodejs.org/api/sqlite.html), [SQLite foreign keys](https://www.sqlite.org/foreignkeys.html).

## Unresolved Questions

None. The specification and existing codebase define the feature scope, stack, validation approach, and test strategy.
