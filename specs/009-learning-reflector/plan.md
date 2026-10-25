# Implementation Plan: Learning Reflector

**Branch**: `009-learning-reflector` | **Date**: 2026-10-13 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/009-learning-reflector/spec.md`

## Summary

After every successful `/chat` turn that carries a `userId`, run a background learning reflector: one structured model call (`withStructuredOutput({ hasLearning, fact })`) over the latest user message only, followed by a deterministic fail-closed safety gate, and then `memories.remember(userId, fact)`. The HTTP response never waits for it, and background failures are reported on stderr without altering the response. Expose a `forget_preference` tool that removes exactly one clearly matching memory of the current user; the user identity comes from a per-request context set by `/chat`, never from model-supplied arguments.

A partial implementation already exists in the working tree and is the starting point for this plan; see [Baseline](#baseline-existing-partial-implementation) for what is kept, moved, and corrected.

## Technical Context

**Language/Version**: TypeScript ESM, Node.js 22 LTS, strict mode.

**Primary Dependencies**: Existing only — `@langchain/core` / `@langchain/openai` (structured output, tools), LangGraph strategies, Zod, Express, `node:sqlite`, `node:async_hooks` (`AsyncLocalStorage`). No new packages.

**Storage**: Existing `memories` table through the existing `MemoryStore` (`remember`, `recall`, `forget`). No schema or interface change.

**Testing**: `node:test` via `tsx`. Fake structured model, deterministic injected embedder with `SqliteMemoryStore(":memory:")`, fake strategy for HTTP tests. No network, no model download, no provider calls.

**Target Platform**: Existing Node.js HTTP service (`npm run dev`).

**Project Type**: TypeScript HTTP web service with LangChain agent strategies.

**Performance Goals**: Zero added latency on the `/chat` response path (reflection starts after the response is sent). At most one extra model call and one `remember` per eligible turn.

**Constraints**: Reflect only the latest user message of the same request; skip without `userId`; fail closed on any validation or safety doubt; never log message or fact text; `forget_preference` acts only inside the current-user boundary and deletes only on exactly one clear match; existing `/chat` behavior without `userId` is unchanged.

**Scale/Scope**: One background task per eligible chat turn; a forget request scans at most the top three recalled memories of one user. No queue, retry, batching, HTTP endpoint for forgetting, or MCP exposure of `forget_preference`.

## Baseline: existing partial implementation

The working tree already contains code for this feature, written before this plan. Current state: `npm run typecheck` fails (2 errors) and 1 test fails, both in `tests/learning-reflection.test.ts`.

| Existing piece | Location | Plan |
|---|---|---|
| `learningReflectionSchema` (`hasLearning`, `fact`, cross-field rule) | `src/domain/domain.ts` | Keep; move with the learning rules into `src/domain/learning.ts`. |
| `validateLearningFact` (keyword secret check, transient deny-list, English-only "durable word" allow-list) | `src/domain/domain.ts` | Rework per [research.md](./research.md) Decisions 3 and 4: add secret-shape detection and Portuguese terms, drop the allow-list. |
| `reflectUserLearning` | `src/strategies/reflection.ts` | Move to `src/memory/learning-reflector.ts`; `strategies/reflection.ts` stays the critic wrapper only. Return a typed outcome instead of a boolean. |
| Fire-and-forget hook and `learningReflector` option | `src/http/server.ts` | Keep; start it after the response is sent, add an injectable error reporter, stop logging free text. |
| `forget_preference` tool with model-supplied `userId` | `src/tools/forget-preference.ts` | Rework: remove `userId` from the input, resolve the user from the request context, apply the clear-match rule. |
| Tool registration under key `forget_preference` | `src/tools/index.ts` | Keep conditional registration; rename the key to `forgetPreference` to match the other keys. |
| Strategy registry passing `memoryStore` to tools | `src/agentes/index.ts`, `src/index.ts` | Keep. |
| `tests/learning-reflection.test.ts` | `tests/` | Replace with the focused test files listed under Project Structure. |

The current `tasks.md` predates this plan and does not reflect the baseline; regenerate it with `/speckit-tasks`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. MVC and controlled effects**: PASS. Pure learning rules live in `src/domain/learning.ts`; the reflector and forget service orchestrate the model and store in `src/memory/`; the tool and the HTTP controller stay thin adapters.
- **II. Zod-validated contracts**: PASS. The structured model output, the tool input, the tool outcome, and the reflector outcome are Zod-validated. Model output is treated as untrusted provider data and re-parsed before use.
- **III. Explicit errors**: PASS. Malformed reflection output raises a domain error; background failures are reported, never swallowed; forget outcomes are explicit (`deleted`, `not_found`, `ambiguous`, `unavailable`) rather than success-shaped fallbacks.
- **IV. Tests and quality**: PASS. Every new rule has `node:test` coverage with fakes and `:memory:`; the plan restores green `npm test` and `npm run typecheck`.
- **V. Security and specification workflow**: PASS WITH DOCUMENTED SCOPE. Secrets are rejected before persistence and never logged. `userId` remains a trusted client-supplied identity as in feature 008; authentication is out of scope. Destructive forgetting is guarded by code (context-bound user, single clear match), not by trust in the model.

No unresolved clarifications.

## Phase 0: Research

See [research.md](./research.md). Decisions cover: binding tools to the current user, reflector placement and trigger point, structured-output validation, the fail-closed safety gate, the durability policy, the forget matching rule, failure reporting, and tool exposure.

## Phase 1: Design & Contracts

- Entities, validation rules, and outcomes: [data-model.md](./data-model.md).
- Reflector behavior: [contracts/learning-reflector.md](./contracts/learning-reflector.md).
- Tool input, outcomes, and guardrails: [contracts/forget-preference-tool.md](./contracts/forget-preference-tool.md).
- `/chat` changes: [contracts/chat-http.md](./contracts/chat-http.md).
- Runnable validation: [quickstart.md](./quickstart.md).

### Post-Design Constitution Check

- **I. MVC and controlled effects**: PASS. The only ambient mechanism is the per-request user context (`AsyncLocalStorage`), confined to one small module, set only by the controller and read only by the forget tool.
- **II. Zod-validated contracts**: PASS. All four boundaries have schemas in the data model.
- **III. Explicit errors**: PASS. `LearningValidationError` covers malformed output; rejected candidates are an explicit non-error outcome with a reason code.
- **IV. Tests and quality**: PASS. Test files and scenarios are enumerated per contract.
- **V. Security and specification workflow**: PASS WITH DOCUMENTED SCOPE. Same trust boundary as 008; logs carry the user identifier and a reason code only.

## Project Structure

### Documentation (this feature)

```text
specs/009-learning-reflector/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── learning-reflector.md
│   ├── forget-preference-tool.md
│   └── chat-http.md
└── tasks.md                       # Regenerate with /speckit-tasks
```

### Source Code (repository root)

```text
src/
├── domain/
│   ├── learning.ts                # NEW: reflection schema, pure fact safety/durability rules, forget outcome schema
│   ├── domain.ts                  # Remove the learning rules moved to learning.ts
│   └── errors.ts                  # Add LearningValidationError
├── memory/
│   ├── learning-reflector.ts      # NEW (moved from strategies/reflection.ts): structured call + gate + remember
│   ├── forget-preference.ts       # NEW: recall + single-clear-match rule + forget
│   └── user-context.ts            # NEW: per-request current-user context
├── strategies/
│   ├── reflection.ts              # Remove reflectUserLearning; critic wrapper only
│   └── plan-and-execute.ts        # Add a forget_preference plan step
├── tools/
│   ├── forget-preference.ts       # Thin tool: input { preference }, user from context
│   └── index.ts                   # Register as forgetPreference when a memory store is configured
└── http/
    └── server.ts                  # Run the strategy inside the user context; reflect after the response; error reporter

tests/
├── domain/
│   └── learning.test.ts           # Safety and durability rules, schema cross-field rule
├── memory/
│   ├── learning-reflector.test.ts # Outcomes, malformed output, no write on rejection
│   └── forget-preference.test.ts  # One match, none, ambiguous, other user
├── tools/
│   ├── forget-preference.test.ts  # Context binding, no user, no store
│   └── index.test.ts              # Conditional registration
├── http/
│   └── server.test.ts             # Non-blocking, skip without userId, failure isolation
└── learning-reflection.test.ts    # DELETE (replaced by the files above)
```

**Structure Decision**: Extend the existing single TypeScript service. Learning is a memory concern, so the reflector and the forget service join `src/memory/`, with pure rules in `src/domain/learning.ts`. `src/strategies/reflection.ts` keeps its original single purpose (answer critic), which avoids two unrelated "reflection" concepts in one file.

## Complexity Tracking

No constitution violations. One design choice is worth flagging for review: the current user reaches the tool through `AsyncLocalStorage` instead of an explicit parameter, because strategies are built once in the registry and `ReasoningStrategy.run(input)` carries no request context. The explicit alternative (changing the strategy interface and every strategy and wrapper) was rejected as a much larger change for a single tool; see [research.md](./research.md) Decision 1.
