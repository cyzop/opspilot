# Feature Specification: History Summarization

**Feature Branch**: `011-history-summarization`

**Created**: 2026-10-19

**Status**: Draft

**Input**: User description: "Sumarização de histórico (prunning): tabela conversation_summaries; o que sai das 8 mensagens recentes vira resumo de ~151 tokens preservando decisões, fatos e pendencias. MESCLADO ao resumo anterior e persistido - refeito só quando 8 novas saem da janela, nunca a cada request. Resumo entra no contexto; evento \"summarize\". com teste fake"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Long conversations keep their important context (Priority: P1)

As an on-call operator in a long OpsPilot conversation, I want older messages that no longer fit in the recent window to be condensed into a short summary that keeps decisions, facts and open items, so that the assistant still remembers what was agreed and what is pending without resending the whole history.

**Why this priority**: Without it, everything older than the recent window is simply dropped, and the assistant forgets decisions and pending actions from earlier in the shift. This is the core value of the feature.

**Independent Test**: Using a fake summarizer, run a conversation past 16 messages; verify that the next turn's context contains the 8 most recent messages verbatim plus a summary covering the 8 messages that left the window, and that the summary was produced from exactly those messages.

**Acceptance Scenarios**:

1. **Given** a conversation whose 8 most recent messages are kept verbatim, **When** 8 messages have left that recent window and are not yet summarized, **Then** those 8 messages are condensed into a summary that preserves decisions, facts and pending items, and the summary is stored for the conversation.
2. **Given** a conversation with a stored summary, **When** a new turn is answered, **Then** the context sent to the assistant contains the stored summary, followed by any messages that left the window but are not yet summarized, followed by the 8 most recent messages, and then the current message.
3. **Given** a conversation that has never had 8 messages leave the recent window, **When** a turn is answered, **Then** no summary is produced and the context is unchanged from today's behavior apart from the recent-window size.

---

### User Story 2 - Summaries are merged, persisted and refreshed only in batches (Priority: P1)

As the OpsPilot operator paying for model usage, I want the summary to be rebuilt only when a full batch of 8 new messages has left the window, merging it with the previous summary and persisting the result, so that summarization never runs on every request and nothing summarized earlier is lost.

**Why this priority**: Summarizing on every turn would add a model call and latency to each request, defeating the purpose of pruning. Merging is what keeps older decisions alive across many refreshes.

**Independent Test**: With a fake summarizer that counts its calls, send 30+ messages in one conversation; verify the summarizer is called only when the count of unsummarized messages outside the window reaches 8, that each call receives the previous summary plus exactly the new batch, and that the stored summary survives a restart of the service.

**Acceptance Scenarios**:

1. **Given** fewer than 8 unsummarized messages outside the recent window, **When** a turn is answered, **Then** the summarizer is not called and the stored summary is reused as-is.
2. **Given** a stored summary and 8 new messages outside the window, **When** a turn is answered, **Then** the summarizer receives the previous summary together with those 8 messages, and the new merged summary replaces the previous one.
3. **Given** a stored summary, **When** the service restarts and the conversation continues, **Then** the stored summary and its coverage are loaded and used without resummarizing old messages.
4. **Given** a summary was refreshed in a turn, **When** the immediately following turn is answered, **Then** no summarization happens.

---

### User Story 3 - Summarization is visible in the trace (Priority: P2)

As a developer or operator inspecting a response, I want a `summarize` event in the response trace whenever a summary is produced (or fails), so that I can see when pruning happened and how much it condensed.

**Why this priority**: Observability of when and how summarization runs, building on the existing trace and token metrics; useful but not required for the context benefit.

**Independent Test**: Trigger a summarization turn with the fake summarizer and verify the response trace contains exactly one `summarize` event with the number of messages condensed and the estimated size of the new summary; verify non-summarizing turns have no such event.

**Acceptance Scenarios**:

1. **Given** a turn in which the summary is refreshed, **When** the response is returned, **Then** the trace contains one `summarize` event stating how many messages were condensed and the estimated token size of the resulting summary.
2. **Given** a turn in which no summarization happens, **When** the response is returned, **Then** the trace contains no `summarize` event.
3. **Given** a turn in which summarization fails, **When** the response is returned, **Then** the trace contains a `summarize` event marked as failed, the answer is still returned, and the previous summary remains stored unchanged.
4. **Given** any turn with a stored summary, **When** the response is returned, **Then** the context breakdown reports the estimated size of the summary as its own source.

---

### Edge Cases

- A conversation exactly at 16 messages before the current turn: the oldest 8 have left the window, so the first summary is produced on that turn.
- More than 8 unsummarized messages outside the window (for example after an earlier failed summarization): the whole pending set is summarized in one call, then coverage advances past all of them.
- The summarizer fails, times out or returns empty or malformed output: the previous summary and its coverage are kept, the pending messages remain in the context verbatim, the failure is reported in the trace and through operational error logging, and summarization is retried on the next turn.
- The summarizer returns a summary far longer than the target: a summary above twice the target size (estimated) is rejected and handled as a failed summarization.
- Messages contain credentials or secrets: they are redacted before being sent to the summarizer, and the stored summary is redacted again before persisting.
- Two requests for the same conversation arrive at the same time: at most one summary replaces the stored one for the same batch; a request never overwrites a summary that already covers more messages than its own.
- A request without a conversation identifier: there is no history, so no summarization occurs.
- A failed chat turn (timeout, strategy error): if summarization already succeeded in that turn the stored summary is kept, since it reflects messages that were already persisted.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST keep the 8 most recent messages of a conversation verbatim in the context of each turn (the recent window).
- **FR-002**: The system MUST keep, per conversation, at most one current summary together with its coverage — which messages it already condenses — and persist it so it survives service restarts.
- **FR-003**: The system MUST trigger summarization only when the number of messages that have left the recent window and are not covered by the stored summary is 8 or more; it MUST NOT summarize on any other turn.
- **FR-004**: When triggered, the system MUST send the previous summary (if any) and all pending messages to the summarizer, and MUST replace the stored summary with the merged result, advancing its coverage to the last message summarized.
- **FR-005**: The summary MUST preserve decisions taken, relevant operational facts and pending items/next steps, and MUST target about 151 tokens (estimated with the project's chars/4 rule); summaries above 302 estimated tokens MUST be rejected as failed.
- **FR-006**: The context sent to the assistant MUST be composed in this order: semantic memory facts (when present), the stored summary (when present), pending messages not yet covered by the summary, the recent window, and the current message.
- **FR-007**: On a turn where summarization runs successfully, the response trace MUST contain exactly one `summarize` event with the number of messages condensed and the estimated size of the new summary; on a failed attempt, the event MUST indicate failure; on other turns, no such event appears.
- **FR-008**: A failed summarization MUST NOT fail the chat turn, MUST keep the previous summary and coverage unchanged, MUST be reported through the established operational error logging, and MUST be retried on the next turn.
- **FR-009**: Messages MUST be redacted of secrets using the project's existing redaction rules before reaching the summarizer, and the summary MUST be redacted again before being stored or added to the context.
- **FR-010**: Summarizer output MUST be validated (non-empty text within the size limit) before being stored.
- **FR-011**: The context breakdown reported in each response MUST include the summary as its own estimated source, and its total MUST include it.
- **FR-012**: Concurrent turns on the same conversation MUST NOT replace a stored summary with one of lesser or equal coverage.
- **FR-013**: The summarizer MUST be replaceable, so that automated tests use a deterministic fake summarizer and never call a real model.
- **FR-014**: Automated tests MUST cover: no summarization below the threshold; the first summarization at 8 pending messages; merging with the previous summary; no resummarization on the next turn; persistence across a new store instance; context ordering; the `summarize` trace event on success and failure; failure keeping the previous summary; size-limit rejection; secret redaction; and the summary source in the context breakdown.

### Key Entities

- **Conversation Summary**: The current condensed memory of a conversation's older messages. Attributes: owning conversation, summary text, coverage (last message it condenses and how many messages that is), estimated size, last update time. One per conversation; replaced on each successful refresh.
- **Recent Window**: The 8 most recent messages of a conversation, always sent verbatim.
- **Pending Messages**: Messages older than the recent window that are not yet covered by the summary; sent verbatim until a batch of 8 is reached and summarized.
- **Summarize Event**: A trace entry recording that a summary refresh happened (or failed), with message count and estimated size.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a 40-message conversation, summarization runs at most 3 times (once per batch of 8 messages leaving the window), never on two consecutive turns.
- **SC-002**: For conversations of any length, the history portion of the context (summary + pending + recent window) stays bounded at no more than 15 verbatim messages plus one summary of at most 302 estimated tokens.
- **SC-003**: 100% of decisions, facts and pending items present in scripted test conversations are still present in the summary passed to the assistant after two consecutive merges (verified with the fake summarizer).
- **SC-004**: A summary persisted before a service restart is used on the next turn without any additional summarization call.
- **SC-005**: A summarization failure never causes a chat request to fail; 100% of such turns still return an answer and report the failure in the trace.
- **SC-006**: The full automated test suite runs without contacting any real model for summarization.

## Assumptions

- The user named a dedicated `conversation_summaries` table, the 8-message window and batch size, the ~151-token target, merge-with-previous behavior and a `summarize` trace event; the plan will honor these.
- The recent window changes from the current 12 messages to 8 for chat context; the batch size equals the window size (8).
- Messages that left the window but are not yet summarized stay in the context verbatim until their batch is summarized, so no information is lost between refreshes; this bounds the history at 8–15 verbatim messages plus the summary.
- Summarization runs synchronously inside the turn that reaches the threshold, before the assistant answers, so the fresh summary is used immediately; this adds one model call only on those turns.
- "Upper size limit" is set to twice the target (302 estimated tokens); the chars/4 estimate from feature 010 is the measuring rule.
- The `summarize` event content reports counts and size, not the full summary text, to keep traces short; the summary itself is inspectable through the persisted record.
- Only the chat endpoint's conversation flow is in scope; arena, bench and MCP flows are unchanged.
- The summarizer uses the same configured model provider as the assistant in production; tests always use a fake.
