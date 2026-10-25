# Data Model: Learning Reflector

No table or column is added. Learned facts are ordinary rows of the existing `memories` table (feature 008) written through `MemoryStore.remember`. This document defines the in-memory values exchanged at the feature's boundaries; each has a Zod schema.

## Learning Candidate (structured model output)

| Field | Type | Rules |
|---|---|---|
| `hasLearning` | boolean | Required. |
| `fact` | string | Trimmed. Non-empty when `hasLearning` is true; empty when it is false. |

- Unknown fields are rejected.
- A violation of the cross-field rule is malformed output: it raises `LearningValidationError` and nothing is written.

## Fact safety result (pure domain rule)

Input: the candidate fact and the latest user message. Output: either the accepted, cleaned fact or a rejection reason.

| Reason | Meaning |
|---|---|
| `invalid` | Empty after trimming, longer than 280 characters, or multi-line. |
| `secret` | Credential vocabulary or a secret-shaped value in the fact, or overlap with a secret-shaped value in the message. |
| `transient` | A question, one-time request, temporary instruction, incident state, or forget request. |

Rules are listed in [research.md](./research.md) Decisions 4 and 5. Any doubt resolves to rejection.

## Learning Outcome (reflector result)

| Variant | Fields | When |
|---|---|---|
| Learned | `learned: true`, `inserted: boolean` | The fact passed the gate and `remember` completed. `inserted` is false when the store reused a near-duplicate. |
| Not learned | `learned: false`, `reason` | `reason` is `no_learning` (model returned `hasLearning: false`), `empty_input` (blank user or message), or one of the safety reasons above. |

The outcome never carries the fact or the message text.

## Learned Memory

The existing `Memory` entity: `id`, `userId`, `fact`, `embedding`, `createdAt`. The reflector adds no field. `userId` is always the identity of the chat turn that produced the fact. Deduplication (`> 0.92`) and validation are the store's existing behavior.

## Current User Context

| Field | Type | Rules |
|---|---|---|
| `userId` | string | Trimmed, non-empty. Set only by `/chat` for the duration of one strategy run; absent otherwise. |

Isolated per request. It is the only source of identity for `forget_preference`.

## Forget Request (tool input)

| Field | Type | Rules |
|---|---|---|
| `preference` | string | Trimmed, non-empty. Natural-language description of the preference to forget. |

Unknown fields are rejected. There is no `userId` or memory identifier in the input.

## Forget Outcome (tool output, JSON text)

| Field | Type | Rules |
|---|---|---|
| `outcome` | `deleted` \| `not_found` \| `ambiguous` \| `unavailable` | Required. |
| `deleted` | boolean | True only when `outcome` is `deleted`. |
| `message` | string | Human-readable explanation for the assistant to relay. |
| `candidates` | string[] | Present only when `outcome` is `ambiguous`: the facts of the current user that matched. |

- `deleted`: exactly one memory of the current user had score `>= 0.6` and was removed.
- `not_found`: no memory reached the bar; nothing removed.
- `ambiguous`: two or more reached the bar; nothing removed.
- `unavailable`: no current user in context, or no memory store configured; nothing removed.
- Memory identifiers and other users' facts never appear.

## State transitions

```text
chat turn succeeds ──(userId present)──▶ reflect latest message
    ├─ hasLearning false / rejected ──▶ no write
    ├─ malformed output / model or store failure ──▶ reported, no write
    └─ accepted ──▶ remember(userId, fact) ──▶ memory inserted or existing one reused

forget_preference(preference)
    ├─ no user / no store ──▶ unavailable
    ├─ 0 clear matches ──▶ not_found
    ├─ 1 clear match ──▶ memory deleted
    └─ 2+ clear matches ──▶ ambiguous
```
