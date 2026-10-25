# Research: Learning Reflector

All findings come from the existing codebase and the feature spec; no external research was needed and no new dependency is introduced.

## Decision 1: Bind `forget_preference` to the current user through a per-request context

**Decision**: Add `src/memory/user-context.ts` exposing `runWithCurrentUser(userId, operation)` and `currentUserId()`, backed by `AsyncLocalStorage`. `/chat` runs the selected strategy inside `runWithCurrentUser` when a `userId` is present. The tool input contains only `preference`; the tool reads the user from the context and refuses to act when none is set.

**Rationale**: FR-011 requires the tool to act only for the current user. The existing draft takes `userId` as a model-filled argument, so a prompt could direct the agent at another user's memory. Strategies are created once by the registry and `ReasoningStrategy.run(input: string)` has no request parameter, so the identity cannot be passed explicitly without changing every strategy. Async context propagates through the promise chain of the agent run, including tool invocations, and each request gets an isolated value even under concurrency.

**Alternatives considered**:
- Keep `userId` as a tool argument: rejected; isolation would depend on model behavior (constitution V).
- Extend `ReasoningStrategy.run` with a context argument: rejected for this feature; it touches both strategies, the reflection wrapper, the arena, the bench, and all fakes for the benefit of one tool.
- Build tools and strategies per request with the user closed over: rejected; the registry caches strategies and tests rely on that shape.
- Pass the user through LangChain `configurable`: rejected; it still needs a new parameter on `run` and does not reach the plan-and-execute executor, which calls `tool.invoke(args)` directly.

**Risk to verify during implementation**: confirm with a test that the context is visible inside a tool invoked by the real LangGraph ReAct agent path and by the plan-and-execute executor (using fake models).

## Decision 2: The reflector is a memory service triggered by `/chat` after the response

**Decision**: Move `reflectUserLearning` to `src/memory/learning-reflector.ts`. In `/chat`, after `res.status(200).json(response)`, start the reflector without awaiting it when the request has a `userId` and a memory store is configured. It receives the raw request `message` (not the composed prompt with history and recalled facts) and the request `userId`.

**Rationale**: FR-001 and FR-002. Starting after the response is written makes non-blocking delivery structural rather than incidental. Using the raw message guarantees that recalled facts and history are never re-learned. Each invocation closes over its own message and user, so overlapping turns cannot mix (edge case in the spec). Only the success path reaches this point, so validation failures, strategy errors, and timeouts never trigger learning.

**Alternatives considered**:
- Wrap the strategy (like `withReflection`): rejected; it would delay the answer and would see the composed prompt.
- A queue or worker: rejected as unnecessary for a single-process local service.

## Decision 3: Structured output is re-validated and malformed output is a domain error

**Decision**: Call `model.withStructuredOutput(learningReflectionSchema)` and parse the result again with the same schema. The schema requires `hasLearning: boolean` and `fact: string` (trimmed), with `fact` non-empty exactly when `hasLearning` is true. A parse failure throws `LearningValidationError`, which the caller reports; nothing is written. The model is created lazily on first use and is injectable for tests.

**Rationale**: FR-003 and FR-013; constitution II treats provider output as untrusted. A distinct error class keeps "the model misbehaved" separate from "the candidate was rejected".

**Alternatives considered**:
- Coerce malformed output to `hasLearning: false`: rejected; it hides provider failures (constitution III).

## Decision 4: Deterministic, fail-closed safety gate on the fact

**Decision**: A pure function in `src/domain/learning.ts` evaluates the candidate fact and returns either the cleaned fact or a rejection reason. It rejects when the fact:

- is empty after trimming, longer than 280 characters, or spans multiple lines (`invalid`);
- contains credential vocabulary in English or Portuguese — password/senha, passphrase, token, API key/chave de API, private key/chave privada, secret/segredo, credential/credencial, bearer (`secret`);
- contains a secret-shaped value — PEM header, known key prefixes (`sk-`, `ghp_`, `github_pat_`, `AKIA`, `xox?-`), a JWT, or an unbroken run of 24 or more characters mixing letters and digits (`secret`);
- matches a transient marker (see Decision 5) (`transient`).

The gate also rejects when the latest user message contains a secret-shaped value and the fact shares any token of 8 or more characters with that value.

**Rationale**: FR-004 and FR-006, SC-002, and the mixed-message scenario of User Story 2. The model prompt also forbids secrets, but the guarantee must not rest on the model (constitution V). Rejecting on vocabulary as well as shape means a fact that merely refers to a secret ("my API key is in the vault") is also dropped, which the spec requires ("retaining, paraphrasing, or referring to the secret"). False rejections are acceptable; the spec says uncertain candidates are rejected.

**Alternatives considered**:
- Vocabulary only (the existing draft): rejected; `ghp_...` pasted without the word "token" would pass.
- Redact the secret and store the rest: rejected; the spec asks to reject unless a safe fact stands on its own.
- Entropy scoring: rejected as harder to test and explain than fixed shapes.

## Decision 5: Durability is decided by the model, with a deterministic transient deny-list

**Decision**: The reflector prompt defines a durable fact (stable user preference or reusable context) and lists what must return `hasLearning: false`: one-time requests, questions, commands, temporary instructions, incident or system state, and requests to forget something. The deterministic gate additionally rejects facts that end with a question mark or contain transient or request markers in English or Portuguese (for example: please/por favor, can you/pode, right now/agora, today/hoje, for now/por enquanto, this time/desta vez, this incident/este incidente, forget/esqueça). The English-only "must contain a durable word" allow-list from the existing draft is removed.

**Rationale**: FR-005 and SC-001. The allow-list rejects valid facts in Portuguese ("prefere os alertas críticos primeiro") and any phrasing outside a short word list, which defeats the feature for its actual users. A deny-list fails closed on the patterns that matter while leaving the judgment of durability to the model, which is the role the spec gives it.

**Alternatives considered**:
- Keep the allow-list and add Portuguese words: rejected; still brittle and language-bound.
- No deterministic durability check: rejected; SC-001 needs test-verifiable rejection of one-time requests independent of model behavior.

## Decision 6: Forget only on exactly one clear match

**Decision**: `forgetPreference(memoryStore, userId, description)` in `src/memory/forget-preference.ts` calls `recall(userId, description)` and keeps results with score `>= 0.6` as clear matches. Exactly one clear match is deleted with `forget(userId, id)`; none yields `not_found`; two or more yields `ambiguous` with no deletion. The ambiguous outcome lists the candidate facts of that same user so they can clarify; memory identifiers are never returned. The threshold is a named constant.

**Rationale**: FR-012 and SC-004. `recall` already scopes by user and returns at most three results with score `>= 0.3`. Using `0.3` itself as the match bar would make most requests ambiguous as soon as a user has two loosely related preferences, so a higher bar separates "this is the one" from "related". Going through `recall` and `forget`, both user-scoped, means another user's memory can be neither matched nor disclosed (FR-011). No `MemoryStore` change is needed.

**Alternatives considered**:
- Treat every recall result as a match (the existing draft): rejected; chronic ambiguity.
- Delete the top result when it leads by a margin: rejected; harder to reason about and less conservative than the spec asks.
- Add a `list` or `findSimilar` method to the store: rejected; `recall` is sufficient at this scale.

**Open tuning note**: `0.6` is a starting value for all-MiniLM-L6-v2 and has not been calibrated on real phrasing; tests use deterministic embeddings. Adjust the constant if real use shows too many `not_found` results.

## Decision 7: Failures are reported on stderr with no user content

**Decision**: `ChatServerOptions` gains an injectable `reportLearningError(event)`; the default writes one line to stderr with the user identifier and the error class and message of the failing component. Rejected candidates are not errors: the reflector returns `{ learned: false, reason }` and the server emits no log line for them. No log line ever contains the user message or the candidate fact.

**Rationale**: FR-010. Stderr is the application's established operational channel (`console.error` / `process.stderr.write` in the server entry points). Logging the message or fact could write a secret to the logs, which would defeat the safety gate. Injection lets tests assert that failures are reported without capturing global output.

**Alternatives considered**:
- Log rejected candidates with their text for debugging: rejected for the reason above.
- Count rejections in a metric: out of scope; there is no metrics facility in the project.

## Decision 8: Tool exposure

**Decision**: `createOpsTools(store, memoryStore?)` registers the tool under the key `forgetPreference` (tool name `forget_preference`) only when a memory store is supplied. It is available to the ReAct agent through the tool list, and to plan-and-execute through a new `forget_preference` plan-step variant. It is not exposed by the MCP server, which builds tools without a memory store and has no user identity.

**Rationale**: The integration constraint requires the name `forget_preference` for the assistant. Both chat strategies are "the assistant", and plan-and-execute only executes steps present in its step schema. Keeping MCP unchanged preserves the four-tool catalog fixed by feature 006.

**Alternatives considered**:
- ReAct only: rejected; forgetting would silently not work under `strategy: "plan-and-execute"`.
- Expose on MCP: rejected; no current-user concept there.
