# Research: Context Budget Builder

All decisions come from the repository (features 010/011) and the user's clarification
(Q1 → A). No new dependencies.

## R1. What the builder owns

- **Decision**: `src/context/context-builder.ts` builds the **user-side context string**
  passed to `ReasoningStrategy.run(input)`: memories, summary, window, current message.
  Strategy-internal prompts (planner/replanner/critic) are untouched; ReAct still has none.
- **Rationale**: User chose option A. `run(input: string)` stays the strategy contract, so
  every strategy (incl. `withReflection`) automatically receives the built context.
- **Alternatives**: changing `run` to accept messages — unnecessary for option A.

## R2. Unit of measure and what is measured

- **Decision**: chars/4 via `estimateTokens` (feature 010), measured on the **rendered
  section** including its header line, e.g. `Semantic memory (relevant facts):\n- a\n- b`.
- **Rationale**: identical to how `contextBreakdown` measures sections, so the breakdown and
  the budget agree; if the kept items don't leave room for even one item, the whole section
  (header included) is omitted.

## R3. Trimming rules (pure)

- **Window**: iterate newest → oldest, keep a message while the rendered section stays
  ≤ budget; stop at the first that doesn't fit (so the kept set is always the newest
  contiguous suffix); render kept messages oldest-first. No partial messages.
- **Memories**: stable sort by `score` desc (ties keep recall order), keep facts while the
  rendered section stays ≤ budget, skipping is not allowed (stop at first misfit, so only
  lowest-score facts are dropped); render kept facts in score order.
- **Summary**: if rendered summary ≤ budget keep it; otherwise drop trailing lines until
  `header + kept lines + "\n[…resumo truncado]"` fits; if not even the first line fits,
  cut the first line by characters to fit; if header + marker alone exceed the budget,
  omit the section.
- **Zero budget**: section omitted, everything reported as dropped.
- **Rationale**: deterministic, whole-item, and "drops least valuable first" by construction
  (SC-002). Stopping at the first misfit (instead of greedily skipping to smaller items)
  guarantees nothing newer/higher-score is dropped while older/lower-score remains.

## R4. Configuration

- **Decision**: `loadContextBudget(env = process.env)` with Zod:
  `CONTEXT_BUDGET_SUMMARY` (default 200), `CONTEXT_BUDGET_WINDOW` (1200),
  `CONTEXT_BUDGET_MEMORY` (300); each `z.coerce`-free regex `^\d+$` → int ≥ 0. Invalid →
  `ConfigurationError("CONTEXT_BUDGET_WINDOW must be a non-negative integer")`.
  `createChatServer` resolves it once at construction (option `contextBudget` overrides for
  tests), so `npm run dev` fails at startup on bad values.
- **Rationale**: constitution II/III (validate config, explicit errors); existing
  `ConfigurationError` class.

## R5. Integration points

- `src/http/server.ts`: replace `composeChatContext(...)` with `buildContext({ message,
  history: prepared.messages, summary: prepared.summary, memories: memoryResults.map(({memory,
  score}) => ({ fact: memory.fact, score })), budget })`; breakdown uses built sections;
  metrics gain `contextBudget` report.
- `src/http/compose-chat-prompt.ts`: becomes a thin wrapper calling `buildContext` with an
  unlimited budget (keeps existing tests and FR-011 identity).
- `src/arena.ts`, `src/bench.ts`: pass `buildContext({ message: input, budget }).prompt`
  (equals the bare question) so all strategy entry points go through the builder.

## R6. Reporting

- **Decision**: chat `metrics.contextBudget = { summary, window, memory }`, each
  `{ budget, keptTokens, droppedItems, droppedTokens, truncated }`.
  `droppedItems` = messages/facts removed (summary: lines removed);
  `droppedTokens` = estimated tokens removed.
- **Rationale**: FR-010/SC-005; complements `contextBreakdown` (which now reflects post-trim).

## Revision (implementation)

The user supplied a reference sketch at /speckit-implement and chose: shared `SYSTEM_PROMPT` section (cut `never`), summary cut `never`, order system → summary → history → memories → message. Budget keys/env follow the sketch: `CONTEXT_BUDGET_SYSTEM` (400), `CONTEXT_BUDGET_SUMMARY` (200), `CONTEXT_BUDGET_HISTORY` (1200), `CONTEXT_BUDGET_MEMORIES` (300). R1 (no shared system), the summary truncation in R3 and FR-011 identity are superseded; see the updated data-model.md and contracts/context-budget.md. The builder stays pure (caller fetches data) per constitution I.
