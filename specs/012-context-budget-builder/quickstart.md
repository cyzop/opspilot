# Quickstart: Context Budget Builder

## 1. Automated validation

```bash
npm run typecheck
npm test
```

Coverage (see [data-model.md](./data-model.md)):

- `tests/context/context-builder.test.ts` — section order (system → summary → history →
  memories → message); low ceilings cut history oldest-first and memories lowest-score-first
  (ties keep recall order); system and summary never cut but flagged `overBudget`; zero
  ceilings omit history/memories; oversized newest message; "tetos baixos cortam na ordem
  certa"; `loadContextBudget` defaults, overrides and invalid values.
- `tests/http/server.test.ts` — `metrics.contextBudget`, enforced history ceiling,
  reflection-wrapped strategy receives the built prompt, invalid env blocks server creation.
- `tests/arena`, `tests/bench` — strategies receive the built prompt.

## 2. Live check with tight budgets

```bash
CONTEXT_BUDGET_HISTORY=300 CONTEXT_BUDGET_MEMORIES=50 npm run dev
TURNS=12 npm run conversa-longa
```

Expected (see [contracts/context-budget.md](./contracts/context-budget.md)): the `history`
estimate never exceeds 300; summaries above 200 enter whole and show `overBudget: true`:

```bash
curl -s localhost:3000/chat -X POST -H "Content-Type: application/json" \
  -d '{"message":"o que está pendente?","conversationId":"<id>"}' | jq '.metrics.contextBudget'
```

## 3. Invalid configuration

```bash
CONTEXT_BUDGET_HISTORY=abc npm run dev
```

Expected: the server fails to start with
`CONTEXT_BUDGET_HISTORY must be a non-negative integer (got "abc")`.
