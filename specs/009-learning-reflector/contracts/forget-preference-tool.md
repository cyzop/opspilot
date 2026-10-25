# Contract: `forget_preference` Tool

## Identity

- Tool name: `forget_preference`
- Registry key in `createOpsTools`: `forgetPreference`
- Registered only when a memory store is supplied. Not exposed by the MCP server.

## Input

```json
{ "preference": "prefers critical alerts first" }
```

- `preference`: required, trimmed, non-empty.
- Unknown fields, including `userId`, are rejected.

## Current user

The tool reads the user from the per-request context set by `/chat`. It never accepts an identity from its arguments.

## Output

JSON text matching the Forget Outcome in [data-model.md](../data-model.md).

| Situation | `outcome` | Deletion |
|---|---|---|
| No current user, or no memory store | `unavailable` | none |
| No memory of the current user with score `>= 0.6` | `not_found` | none |
| Exactly one such memory | `deleted` | that memory only |
| Two or more such memories | `ambiguous` (with `candidates`) | none |

## Guarantees

- Reads and deletes go only through `recall(currentUser, …)` and `forget(currentUser, id)`.
- Another user's memories are never matched, listed, or deleted.
- Memory identifiers are never returned.
- Store failures propagate as tool errors; they are not reported as `not_found`.

## Strategy availability

- ReAct: available through the tool list.
- Plan-and-execute: available through a `forget_preference` plan step whose `args` use this input schema.

## Required tests

- One clear match → deleted, later recall does not return it.
- No match → `not_found`, store unchanged.
- Two clear matches → `ambiguous`, both remain, `candidates` lists both facts.
- A matching memory that belongs to another user → `not_found`, that memory remains, its text absent from the output.
- No current user in context → `unavailable`, no store call.
- Input containing `userId` → rejected by the schema.
- Tool invoked from inside a strategy run sees the context user (ReAct tool path and plan-and-execute executor, with fake models).
- `createOpsTools` registers the tool only when a memory store is supplied.
