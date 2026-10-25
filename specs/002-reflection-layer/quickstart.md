# Quickstart: OpsPilot Reflection Layer

## Prerequisites

- Node.js 22 LTS and dependencies installed.
- For live model-backed runs, configure `OPENROUTER_API_KEY` and
  `OPENROUTER_MODEL` without printing or committing secrets.

## Deterministic validation

```powershell
npm test
npm run typecheck
```

Expected: fake-backed reflection tests validate approval, rejection,
feedback-driven regeneration, retry exhaustion, trace order, errors, and exact
call accounting without making network requests. They also verify that only
sanitized observations—not private reasoning or credential-like values—reach
the critic.

## Arena selectors

```powershell
npm run arena -- --help
npm run arena -- --strategies reflect:react --max-reflection 2 "Quantos alertas críticos estão disparando?"
npm run arena -- --strategies reflect:plan-and-execute --max-iterations 8 --max-reflection 1 "Avalie os alertas e resuma as ações necessárias."
```

Expected: each reflected selector runs its corresponding base strategy, reviews
its answer against observations, appends critique events, and includes critic
calls in the total metrics. At the retry ceiling, the latest answer is returned
with an explicit unapproved critique if no review approved it.

## Related contracts

- [Reflection strategy](contracts/reflection-strategy.md)
- [Arena options](contracts/arena.md)
- [Shared reasoning strategy](../001-reasoning-core/contracts/reasoning-strategy.md)
