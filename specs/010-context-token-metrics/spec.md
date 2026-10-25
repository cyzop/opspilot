# Feature Specification: Context Token Metrics

**Feature Branch**: `010-context-token-metrics`

**Created**: 2026-10-19

**Status**: Draft

**Input**: User description: "Instrumente a medição de contexto: src/context/tokens.ts com estimateTokens (chars/4) e o usage real do LangChain; métricas do /chat com promptTokens real e contextBreakdown estimado por fontes; conversa-longa.sh imprime o promptTokens por turno. com testes"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See the real prompt size of each chat turn (Priority: P1)

As an OpsPilot operator, I want every chat response to report how many prompt tokens the model provider actually billed for that turn so that I can see the true context cost of a conversation instead of guessing.

**Why this priority**: The real, provider-reported number is the ground truth for cost and context-window pressure. Without it, every other measurement is unverifiable.

**Independent Test**: Send one chat message through a model that reports usage and verify that the response metrics contain a `promptTokens` value equal to the sum of the input tokens reported by the provider for every model call made during that turn.

**Acceptance Scenarios**:

1. **Given** a chat turn whose model calls all report token usage, **When** the response is returned, **Then** its metrics include `promptTokens` equal to the sum of the provider-reported input tokens across all model calls of that turn.
2. **Given** a chat turn that makes several model calls (tool loop, planning and replanning, or critique), **When** the response is returned, **Then** `promptTokens` accounts for every one of those calls, not only the first or the last.
3. **Given** a chat turn in which the provider reports no usage for at least one model call, **When** the response is returned, **Then** `promptTokens` is explicitly marked as unavailable (null) rather than reported as zero or as a partial sum, and the turn itself still succeeds.

---

### User Story 2 - Understand where the context comes from (Priority: P1)

As an OpsPilot operator, I want each chat response to include an estimated breakdown of the prompt by source so that I can tell whether context growth is driven by conversation history, recalled memory, or the current message.

**Why this priority**: Knowing the total is not enough to act; the breakdown tells the operator which source to trim. It is equally critical to the feature's purpose of instrumenting context.

**Independent Test**: Send a chat turn with known history, known recalled memory facts and a known message; verify that the response's `contextBreakdown` lists each source with an estimated token count equal to that source's character length divided by four, rounded up.

**Acceptance Scenarios**:

1. **Given** a chat turn with prior history, recalled memory facts and a current message, **When** the response is returned, **Then** `contextBreakdown` contains one entry per source — `history`, `memory`, `message` — each with a non-negative estimated token count.
2. **Given** a chat turn without a conversation identifier or without a user identity, **When** the response is returned, **Then** the `history` and/or `memory` entries are present with an estimate of zero.
3. **Given** any chat turn, **When** the response is returned, **Then** the breakdown is clearly labeled as an estimate and also reports its estimated total, so it is never confused with the real `promptTokens`.

---

### User Story 3 - Observe context growth across a long conversation (Priority: P2)

As a developer studying agent behavior, I want a script that drives a long multi-turn conversation against a running OpsPilot server and prints the real prompt tokens of each turn so that I can watch the context grow and confirm where it plateaus once the history window is full.

**Why this priority**: It turns the metrics into a demonstrable learning artifact, but it depends on Stories 1 and 2 already being in place.

**Independent Test**: Start the chat server, run the script, and verify it prints one line per turn with the turn number and that turn's `promptTokens`, all turns sharing the same conversation.

**Acceptance Scenarios**:

1. **Given** a running chat server, **When** the script is run with its defaults, **Then** it sends a sequence of messages in a single conversation and prints, for each turn, the turn number and the turn's `promptTokens`.
2. **Given** the script runs more turns than the history window holds, **When** the output is inspected, **Then** the reported prompt size stops growing in proportion to the number of turns once older messages leave the history window.
3. **Given** the server is unreachable or a turn returns an error, **When** the script runs, **Then** it stops with a clear error message and a non-zero exit status instead of printing misleading numbers.
4. **Given** a turn whose `promptTokens` is unavailable, **When** the script prints that turn, **Then** it shows the value as unavailable rather than as zero.

---

### Edge Cases

- Empty text in any source yields an estimate of exactly zero tokens for that source.
- Text whose length is not a multiple of four is rounded up, so any non-empty source estimates at least one token.
- Non-ASCII text (accents, emoji) is estimated by its character count, consistent with the chars/4 rule; the estimate is not expected to match the provider's tokenizer.
- The provider reports usage in a different field shape or omits it entirely; the reported usage is validated and treated as unavailable if it is missing or malformed, never as a fabricated number.
- A turn fails or times out after some model calls already reported usage; no metrics are returned for that failed turn and the existing error responses are unchanged.
- The background learning reflection that runs after the response is not part of the turn's `promptTokens`, since it happens after the response is delivered.
- Existing callers that only read `llmCalls`, `latencyMs` and `historyMessages` continue to work unchanged.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide a token estimation rule that returns the number of characters of a text divided by four, rounded up, and zero for empty text.
- **FR-002**: The system MUST capture the provider-reported input token usage of every model call made while answering a chat turn, across all reasoning strategies (including the reflection critique when enabled).
- **FR-003**: The system MUST validate provider-reported usage before using it; missing or malformed usage MUST be treated as unavailable.
- **FR-004**: Chat responses MUST include `promptTokens` in their metrics: the sum of the provider-reported input tokens of all model calls in the turn, or null when any call's usage was unavailable.
- **FR-005**: Chat responses MUST include a `contextBreakdown` in their metrics with an estimated token count for each context source — conversation history, recalled memory, and current message — plus the estimated total of these sources.
- **FR-006**: The `contextBreakdown` estimates MUST be computed from exactly the content that was sent to the model for each source in that turn (after history-window truncation), using the estimation rule from FR-001.
- **FR-007**: The new metrics MUST be validated at the HTTP boundary together with the existing response contract, and the existing metrics fields MUST remain unchanged.
- **FR-008**: Token estimation and breakdown computation MUST be pure, side-effect-free logic; capturing provider usage MUST be isolated to the model-call boundary.
- **FR-009**: The project MUST provide a long-conversation script that sends a configurable number of turns (with a default larger than the history window) to a running chat server within a single conversation and prints the turn number and `promptTokens` of each turn.
- **FR-010**: The long-conversation script MUST allow the server address to be configured, MUST stop with a non-zero exit status on connection or response errors, and MUST display unavailable `promptTokens` explicitly.
- **FR-011**: Automated tests MUST cover the estimation rule (including empty, rounding and non-ASCII cases), usage capture and summation (including missing/malformed usage and multi-call turns), the breakdown computation, and the presence and validation of the new fields in the chat response.

### Key Entities

- **Token Estimate**: An approximate token count for a piece of text, derived only from its character length (chars/4, rounded up). Cheap, deterministic, tokenizer-independent.
- **Model Usage**: The input token count the provider reports for a single model call. May be unavailable.
- **Prompt Tokens (per turn)**: The sum of Model Usage input tokens over all model calls of one chat turn; null when any call's usage is unavailable.
- **Context Breakdown**: The set of estimated token counts per context source (history, memory, message) for one turn, plus their estimated total.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of successful chat responses include both `promptTokens` (a number or explicit null) and a `contextBreakdown` with all three sources.
- **SC-002**: For a model that reports usage, the reported `promptTokens` matches the provider's own per-call input totals exactly (0 tokens of discrepancy) in automated tests with scripted usage.
- **SC-003**: For every source, the estimated token count equals the character length divided by four, rounded up, in 100% of tested inputs.
- **SC-004**: An operator can run the long-conversation script and obtain a per-turn prompt-size listing for a conversation of at least 10 turns with a single command.
- **SC-005**: In a run with more turns than the history window, the operator can identify from the printed output the turn after which prompt size stops growing turn over turn.
- **SC-006**: The full automated test suite and type checking pass with the new behavior in place, and no existing test needs to change its expectations for previously existing fields.

## Assumptions

- The user explicitly named the token module location, the chars/4 estimation rule, the use of LangChain's reported usage, and a shell script named `conversa-longa.sh`; the plan will honor these choices.
- "Real" prompt tokens means the provider-reported input tokens as surfaced by the model integration; no local tokenizer is added.
- `promptTokens` aggregates all model calls of the turn (sum), since a single turn may call the model several times; per-call values are not exposed in this feature.
- The breakdown covers the three sources the chat composes per turn (history, memory, message). Strategy system instructions and tool definitions are not broken out in this feature, so the estimated total is expected to be lower than the real `promptTokens`; that gap is acceptable and is part of what the operator learns from the comparison.
- The long-conversation script targets a locally running chat server (default `http://localhost:3000`), uses a fixed list of operational questions, and does not require any secrets of its own; the server loads its own configuration.
- The script is a developer/learning tool and is not run as part of the automated test suite; its parsing of responses relies on the validated chat response contract.
- The background learning reflection is excluded from per-turn metrics.
- No persistence of token metrics is required; they are returned per response only.
