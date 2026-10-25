# Feature Specification: Context Budget Builder

**Feature Branch**: `012-context-budget-builder`

**Created**: 2026-10-19

**Status**: Draft

**Input**: User description: "ContextBuilder com orçamento por seção: src/context/context-builder.ts monta o prompt de TODAS as estratégias com teto por seção via env CONTEXT_BUDGET_*: system e mensagem intocáveis, resumo 200, janela 1200 (corta as mais antigas), memórias 300 (corta menor score). Teste: tetos baixos cortam na ordem certa."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Every strategy receives a context that respects per-section limits (Priority: P1)

As the OpsPilot operator, I want the context sent to any reasoning strategy to be assembled in one place with a ceiling for each variable section (conversation summary, recent message window, recalled memories), so that long conversations or many recalled facts can never inflate the prompt beyond a predictable size.

**Why this priority**: Feature 011 bounded the number of history messages, but not their size, and the live run showed summaries of 204–271 estimated tokens and windows over 2,600. Without per-section ceilings, a few long messages or facts still blow up cost and context. This is the core value.

**Independent Test**: Build the context with known inputs whose sections exceed small ceilings; verify each section is reduced to fit its ceiling while the system instructions and the current message are passed through unchanged, for each of the reasoning strategies.

**Acceptance Scenarios**:

1. **Given** a summary, a window of messages and recalled memories that all fit their ceilings, **When** the context is built, **Then** the result contains all of them unchanged, in the established section order.
2. **Given** any section ceiling configuration, **When** the context is built, **Then** the system instructions and the current user message are included exactly as provided, never shortened or dropped.
3. **Given** a chat turn for any reasoning strategy (including reflection), **When** the strategy is run, **Then** it receives the context produced by the same builder and limits.

---

### User Story 2 - Sections are trimmed in the right order when over budget (Priority: P1)

As the OpsPilot operator, I want each oversized section to be cut by a rule that keeps the most valuable content — the newest messages in the history and the highest-scoring memories — while the system instruction and the summary are never cut, so that trimming never removes the most relevant context first.

**Why this priority**: A ceiling is only safe if what it cuts is the least valuable part. The test requested by the user ("tetos baixos cortam na ordem certa") is exactly this.

**Independent Test**: With deliberately low ceilings, build the context and verify that the history lost its oldest messages first, the memories lost their lowest-score facts first, and the system and summary were kept whole (flagged over budget), with nothing else affected.

**Acceptance Scenarios**:

1. **Given** a window ceiling smaller than the window, **When** the context is built, **Then** whole messages are removed starting from the oldest until the remaining window fits, and the remaining messages keep their original order.
2. **Given** a memory ceiling smaller than the recalled facts, **When** the context is built, **Then** whole facts are removed starting from the lowest relevance score until the rest fit, and the kept facts keep their relevance order.
3. **Given** a summary (or system) ceiling smaller than its content, **When** the context is built, **Then** the content is kept whole and the report marks the section as over budget.
4. **Given** a ceiling of zero for a section, **When** the context is built, **Then** that section is omitted entirely.

---

### User Story 3 - Limits are configurable and trimming is visible (Priority: P2)

As an operator tuning cost versus context, I want to adjust each ceiling through environment configuration and see in each chat response how much of each section was kept and dropped, so that I can tune limits with evidence instead of guessing.

**Why this priority**: Defaults solve the common case; configuration and visibility make the limits operable. Depends on Stories 1–2.

**Independent Test**: Start the service with custom ceiling values and verify they are applied; start it with an invalid value and verify it refuses to start with a clear message; verify a chat response reports per-section trimming.

**Acceptance Scenarios**:

1. **Given** no ceiling configuration, **When** the service runs, **Then** the defaults apply: summary 200, window 1,200 and memories 300 estimated tokens.
2. **Given** ceiling values set in the environment, **When** the service starts, **Then** those values replace the defaults for each section.
3. **Given** a negative, non-numeric or fractional ceiling value, **When** the service starts, **Then** it refuses to start with an error naming the invalid setting.
4. **Given** a chat turn in which trimming happened, **When** the response is returned, **Then** its metrics report, per section, the estimated size kept and how many items (messages, facts) or tokens were dropped.

---

### Edge Cases

- The newest message alone exceeds the window ceiling: the window keeps no messages rather than a partial message; the drop is reported.
- A summary or system instruction larger than its ceiling: kept whole, reported as over budget (never cut).
- Memories with equal scores: ties are broken by keeping the earlier-recalled (higher-ranked) fact.
- Empty sections (no summary, no history, no memories): nothing is trimmed; the context matches today's output for the same inputs.
- Ceilings large enough for everything: output is byte-for-byte identical to the untrimmed context.
- Arena and bench runs that pass only a question: the builder still applies, and since there is only a message, the context equals the bare question.
- Pending messages from feature 011 (outside the window, not yet summarized) count as part of the window section and are trimmed oldest-first like any other window message.
- The ceilings measure size with the project's chars/4 estimate (feature 010), so real tokenizer counts may differ.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST assemble the context for every reasoning strategy (ReAct, Plan-and-Execute and the reflection wrapper) through a single context builder.
- **FR-002**: The builder MUST include one shared OpsPilot system instruction (`SYSTEM_PROMPT`) at the top of the context for every strategy, and MUST treat it and the current user message as untouchable: never trimmed or dropped. Strategy-internal step prompts (planner, replanner, critic) are kept as they are.
- **FR-003**: The builder MUST apply a ceiling, in estimated tokens, to each section: system (default 400, informative only), conversation summary (default 200, informative only), recent message history (default 1,200, enforced) and recalled memories (default 300, enforced).
- **FR-004**: When the window exceeds its ceiling, the builder MUST remove whole messages from the oldest onward until the rest fit, preserving chronological order.
- **FR-005**: When recalled memories exceed their ceiling, the builder MUST remove whole facts from the lowest relevance score upward until the rest fit, preserving relevance order among kept facts.
- **FR-006**: The summary MUST never be cut (rule `never`): it is included whole; when it exceeds its ceiling the report flags it as over budget instead of trimming it. The same applies to the system section.
- **FR-007**: A ceiling of zero MUST omit an enforced section (history, memories); ceilings MUST be non-negative integers.
- **FR-008**: Ceilings MUST be configurable per section through environment settings named with the `CONTEXT_BUDGET_` prefix, validated at startup; invalid values MUST prevent startup with an error naming the setting.
- **FR-009**: Section order in the context MUST be: system, summary, history, memories, current message.
- **FR-010**: Chat responses MUST report, per budgeted section, the estimated size kept and what was dropped (messages, facts, or summary tokens), alongside the existing context breakdown, which reflects the post-trim context.
- **FR-011**: With ceilings large enough for all content, the built context MUST contain every input unchanged (no trimming); the prompt intentionally differs from the pre-feature composition (shared system section, new order).
- **FR-012**: Trimming logic MUST be deterministic and side-effect free so it can be unit tested without the service.
- **FR-013**: Automated tests MUST cover: low ceilings cutting history oldest-first and memories lowest-score-first; system and summary never cut but flagged over budget; untouchable message; zero ceilings; ties; oversized single items; section order; defaults; environment overrides; invalid configuration; trimming metrics in the chat response; and every strategy receiving the built context.

### Key Entities

- **Context Budget**: The set of per-section ceilings (summary, window, memories) in estimated tokens, with defaults and environment overrides.
- **Context Section**: One part of the context — system, memories, summary, window, current message — with its content, whether it is budgeted, and its estimated size.
- **Built Context**: The final assembled context passed to a strategy, plus the per-section report of kept size and dropped items.
- **Trim Report**: For each budgeted section: kept estimated tokens, number of items dropped (messages or facts) or tokens removed (summary), and whether it was truncated.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With default ceilings, the enforced part of any chat context (history + memories) never exceeds 1,500 estimated tokens, regardless of conversation length or number of recalled facts.
- **SC-002**: In 100% of tested over-budget cases, the content removed is the oldest messages and the lowest-score facts — never newer messages or higher-score facts while those remain; system and summary are never removed.
- **SC-003**: The system instructions and current message are present and unchanged in 100% of built contexts.
- **SC-004**: An operator can change any section ceiling without code changes, and an invalid value is reported before the service accepts any request.
- **SC-005**: Every chat response lets the operator see, per section, how much was kept and dropped.
- **SC-006**: Every strategy (chat, arena, bench) receives a context that starts with the same shared system instruction.

## Assumptions

- The user named `src/context/context-builder.ts`, the `CONTEXT_BUDGET_*` prefix, the default ceilings (summary 200, window 1,200, memories 300) and the cut rules; the plan will honor them. Setting names: see the revision note below.
- Clarified (Q1 → A) and later **revised by the user at implementation** (reference sketch `buildContext` with `section(name, content, { budget, cut })`): a shared `SYSTEM_PROMPT` section is added (cut `never`), the summary uses cut `never`, and the order is system → summary → history → memories → message. Budget keys follow the sketch: `system`, `summary`, `history`, `memories` (`CONTEXT_BUDGET_SYSTEM|SUMMARY|HISTORY|MEMORIES`).
- The builder stays pure (data fetched by the caller), per constitution I; history comes from feature 011 (pending + recent) rather than a fixed `lastMessages(8)`, and memories keep the existing recall limit.
- The system section is delivered inside the single assembled prompt string ("junta tudo num único prompt"), not as a separate model system message.
- Sizes are measured with the chars/4 estimate from feature 010.
- The summary ceiling (200) is informative: summaries up to feature 011's 302-token limit enter whole, and the report flags `overBudget` (the live run produced 204–271-token summaries).
- Feature 011's pending messages are part of the window section.
- Trimming never calls a model; it only removes or shortens content.
- The window section ceiling applies to the rendered message lines (with role prefixes), consistent with how the context breakdown measures it.
