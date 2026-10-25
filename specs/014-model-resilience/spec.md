# Feature Specification: Model Resilience

**Feature Branch**: `014-model-resilience`

**Created**: 2026-10-19

**Status**: Draft

**Input**: User description: "Resiliencia de modelo: .env: OPENROUTER_MODEL_FALLBACK; fábrica models.ts: withRetry no primário; withFallbacks([reserva]); Trace: evento \"fallback\"; metrics.modelUsed. Caso nada funcione, 503"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Answers survive a flaky or unavailable primary model (Priority: P1)

As an on-call operator, I want OpsPilot to retry the primary model on transient failures and, if it is still unavailable, answer with a configured reserve model, so that a provider hiccup does not leave me without an answer during an incident.

**Why this priority**: Live runs already showed model calls failing (empty structured output, slow responses). Retrying and switching to a reserve model is the core value.

**Independent Test**: With scripted fake models, make the primary fail once and then succeed (answer comes from the primary after a retry), and make the primary fail every time (answer comes from the reserve); verify the chat still returns an answer in both cases.

**Acceptance Scenarios**:

1. **Given** the primary model fails transiently and then succeeds within the retry limit, **When** a chat turn runs, **Then** the answer is produced by the primary model and no reserve model is used.
2. **Given** the primary model keeps failing after all retries and a reserve model is configured, **When** a chat turn runs, **Then** the failed call is served by the reserve model and the turn returns an answer.
3. **Given** no reserve model is configured, **When** the primary keeps failing after all retries, **Then** the turn behaves as if no model is available (User Story 3).

---

### User Story 2 - The operator can see when the reserve model was used (Priority: P1)

As an operator auditing answers, I want each response to say which model served it and to include a `fallback` trace event whenever the reserve model had to be used, so that I know when an answer came from the reserve and why.

**Why this priority**: Silent model switching would hide quality differences and provider problems; visibility is required alongside the switch.

**Independent Test**: With a primary that always fails, verify the response has `metrics.modelUsed` equal to the reserve model and a `fallback` event with the primary model, the reserve model and a redacted reason; with a healthy primary, verify `modelUsed` is the primary and there is no `fallback` event.

**Acceptance Scenarios**:

1. **Given** every model call in the turn was served by the primary, **When** the response is returned, **Then** `metrics.modelUsed` is the primary model and the trace has no `fallback` event.
2. **Given** at least one model call in the turn was served by the reserve, **When** the response is returned, **Then** `metrics.modelUsed` is the reserve model and the trace contains one `fallback` event per switched call, naming the primary model, the reserve model and the redacted failure reason.
3. **Given** a `fallback` event, **When** it is inspected, **Then** it is attributed to the graph stage that made the call (router, strategy or context), like every other trace event.

---

### User Story 3 - Clear "service unavailable" when no model works (Priority: P2)

As a client of the chat API, I want a distinct "service unavailable" response when neither the primary (after retries) nor the reserve model can answer, so that I can tell a temporary model outage apart from a bug and retry later.

**Why this priority**: Today such failures surface as generic server errors; a specific status lets clients and operators react correctly. Depends on stories 1–2.

**Independent Test**: With both fake models always failing, verify the chat endpoint returns the "service unavailable" status with a clear message and does not persist the exchange.

**Acceptance Scenarios**:

1. **Given** both primary and reserve models fail for the call the turn depends on, **When** the chat turn runs, **Then** the response status is 503 with a message stating the models are unavailable, and the user/assistant exchange is not persisted.
2. **Given** only an auxiliary call fails on both models (router or history summarization), **When** the turn runs, **Then** the existing auxiliary fallbacks still apply (router falls back to the direct strategy; summarization keeps the previous summary) and the turn only returns 503 if the answering strategy itself cannot get a model.
3. **Given** other failures (invalid request, unknown conversation, timeout, programming errors), **When** they occur, **Then** their existing status codes are unchanged.

---

### Edge Cases

- The reserve model setting is empty or equal to the primary model: treated as "no reserve configured" (retries only), and this is reported once at startup.
- Missing primary model or API key: unchanged configuration error behavior.
- Non-transient errors on the primary (for example invalid request shape) are not retried; they go straight to the reserve, if any.
- Retries add latency: the retry count and backoff are small so a turn still fits the existing turn timeout in normal conditions; a turn timeout still returns 504.
- A strategy whose model fails on both models inside plan-and-execute or reflection still triggers the feature 013 strategy fallback to ReAct; if ReAct also cannot get a model, the turn returns 503.
- Arena, bench and the MCP server use the same model factory and therefore also gain retry and reserve behavior, but they have no HTTP 503; their existing error output applies.
- Failure reasons in `fallback` events and logs are redacted with the project's secret patterns.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST read an optional reserve model setting named `OPENROUTER_MODEL_FALLBACK` alongside the existing primary model and API key settings.
- **FR-002**: Every model instance created by the project's model factory MUST retry the primary model on failure a bounded number of times (default: 2 attempts, i.e. 1 retry) before giving up on it. The reserve model gets the same bounded retry.
- **FR-003**: When a reserve model is configured, every model instance from the factory MUST switch to the reserve model for a call after the primary fails all its attempts.
- **FR-004**: Each call that switched to the reserve MUST produce a `fallback` trace event containing the primary model, the reserve model and a redacted reason, attributed to the graph stage that made the call.
- **FR-005**: Chat responses MUST include `metrics.modelUsed`: the reserve model's identifier if any call in the turn was served by the reserve, otherwise the primary model's identifier.
- **FR-006**: When the answering strategy cannot get a response from either model, the chat endpoint MUST return status 503 with a clear "models unavailable" message and MUST NOT persist the exchange.
- **FR-007**: Model unavailability MUST be represented by a dedicated domain error and translated to 503 only at the HTTP edge.
- **FR-008**: Existing auxiliary fallbacks (router → ReAct, summarization keeps previous summary, strategy → ReAct) MUST keep working when their model calls fail on both models.
- **FR-009**: Existing status codes for invalid requests (400), unknown conversations (404), unknown strategies (422), timeouts (504) and unexpected errors (500) MUST be unchanged.
- **FR-010**: Retry and fallback behavior MUST be testable with scripted fake models so tests never call a real provider.
- **FR-011**: Automated tests MUST cover: transient primary failure recovered by retry; persistent primary failure served by the reserve with a `fallback` event and `modelUsed` = reserve; healthy primary with `modelUsed` = primary and no event; no reserve configured; both models failing → 503 without persistence; auxiliary fallbacks still applied; reserve equal to primary treated as absent.

### Key Entities

- **Model Configuration**: primary model identifier, optional reserve model identifier, API key, retry count.
- **Fallback Event**: trace entry with the graph stage, primary model, reserve model and redacted reason for one call that switched models.
- **Model Used**: per-turn indicator of which model served the turn (reserve if any call used it).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: When the primary model fails transiently, 100% of turns still return an answer from the primary within the retry limit.
- **SC-002**: When the primary is unavailable and a reserve is configured, 100% of turns return an answer, each marked with the reserve as the model used and at least one `fallback` event.
- **SC-003**: When no model is available, 100% of chat turns return the "service unavailable" status instead of a generic server error, and none persist a partial exchange.
- **SC-004**: Every chat response states which model served it.
- **SC-005**: The automated test suite never contacts a real model provider.

## Assumptions

- The user named `OPENROUTER_MODEL_FALLBACK`, a model factory applying retry on the primary and fallback to the reserve, a `fallback` trace event, `metrics.modelUsed` and status 503; the plan will honor them. The existing factory lives in `src/llm/model.ts` (the user wrote `models.ts`).
- The `fallback` event type is separate from the feature 013 `route` events with `source: "fallback"` (those describe routing/strategy fallback; this one describes model switching).
- Default retry policy (updated at implementation per user input `withRetry({ stopAfterAttempt: 2 })` on both models): 2 attempts with short exponential backoff on the primary, then 2 attempts on the reserve.
- The reserve model uses the same provider and API key as the primary.
- `metrics.modelUsed` is a single identifier per turn (reserve wins if any call used it); per-call detail lives in the `fallback` events.
