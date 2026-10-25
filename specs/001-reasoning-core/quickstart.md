# Quickstart: OpsPilot Reasoning Core

## Prerequisites

- Node.js 22 LTS and npm.
- Dependencies installed with `npm install`.
- For model-backed arena runs, set `OPENROUTER_API_KEY` and `OPENROUTER_MODEL`
  in the process environment or local `.env`. Do not print or commit secrets.
- The current prototype uses `data/ops-store.json` as its local seed database.
  Sequelize/MySQL models remain available for a later persistence adapter.

## Validate deterministic behavior

```powershell
npm test
npm run typecheck
```

Expected: the store, seed fixture, and trace-format tests pass without network
or MySQL access; TypeScript reports no errors.

## Seed the JSON baseline

```powershell
npm run seed
```

Expected: the script creates/restores five services and six alerts (three firing
and three resolved) in `data/ops-store.json`, preserves operator-created
records, and can be re-run without duplicating the baseline. Each strategy loads
an isolated in-memory copy; tool mutations are visible within that run and do
not modify the JSON file.

## Run strategies in the arena

```powershell
npm run arena -- --help
npm run arena -- --strategies react,plan-and-execute --max-iterations 4 "Como está o plantão?"
```

Expected: both strategies receive the same question; each output group contains
an answer, ordered trace, LLM-call count, and latency. Plan-and-Execute performs
no more than eight actions. Missing OpenRouter configuration or invalid options
produce explicit errors.

## Related contracts

- [Reasoning strategy](contracts/reasoning-strategy.md)
- [Agent tools](contracts/agent-tools.md)
- [Arena CLI](contracts/arena-cli.md)
- [Data model](data-model.md)
