# Research: OpsPilot Reasoning Core

## Decision 1: Use the installed LangGraph prebuilt ReAct agent

- **Decision**: Use `createReactAgent` from `@langchain/langgraph/prebuilt` with
  the common model factory and Zod-backed tools. The installed package
  (`@langchain/langgraph` 1.4.18) exports `createReactAgent`; its installed
  declaration marks the API deprecated and says it has moved to the `langchain`
  package. Retain the requested import for this feature and isolate it in
  `react.ts` so a later migration is localized.
- **Rationale**: This matches the requested prebuilt ReAct behavior, avoids
  duplicating the tool-calling loop, and is confirmed against the actual installed
  ESM exports and declaration files.
- **Alternatives considered**: Build ReAct from a custom `StateGraph`; rejected
  because the feature explicitly asks for the prebuilt agent and the custom
  graph is reserved for Plan-and-Execute.
- **References**:
  - [LangGraph JS workflows and agents](https://docs.langchain.com/oss/javascript/langgraph/workflows-agents)
  - [LangGraph JS graph API](https://docs.langchain.com/oss/javascript/langgraph/graph-api)

## Decision 2: Implement Plan-and-Execute as a bounded graph

- **Decision**: Define explicit planner, single-step executor, and replanner graph
  nodes. Planner and replanner produce Zod-validated structured output; after an
  executed step, the replanner returns remaining steps or a final response. Cap
  the initial plan at eight steps and graph replanning cycles at the configured
  `maxIterations`.
- **Rationale**: Explicit graph state makes plan revisions, completed work, final
  response, and stopping conditions observable and testable. One-step execution
  ensures replanning occurs between actions.
- **Alternatives considered**: Execute the whole plan in one node; rejected
  because it prevents the required replan-after-each-step behavior.
- **References**:
  - [LangGraph JS workflows and agents](https://docs.langchain.com/oss/javascript/langgraph/workflows-agents)
  - [LangGraph JS graph API](https://docs.langchain.com/oss/javascript/langgraph/graph-api)

## Decision 3: Count model invocations per strategy run and enforce finite work

- **Decision**: Create a per-run counter shared by planner, replanner, executor,
  and agent model calls. Increment immediately before each actual model
  invocation, including calls that fail. `maxIterations` is the hard cap on
  model invocations in either strategy (including Plan-and-Execute planner and
  replanner); the latter is additionally bounded to eight executed actions.
  For ReAct, use the prebuilt graph's alternating model/tool supersteps to set
  `recursionLimit` to twice the invocation budget; stream graph states so a
  recursion-bound stop retains prior tool observations. Handle
  `GraphRecursionError` as an explicit bounded result. For Plan-and-Execute,
  check the per-run budget before every planner/replanner invocation.
- **Rationale**: Metrics then reflect all model requests made by a run, not only
  the final response. The same invocation budget gives the arena's
  `--max-iterations` option comparable, testable semantics across strategies;
  both strategies have explicit upper bounds when a model fails to make progress.
- **Alternatives considered**: Count tool calls or graph transitions as LLM
  calls; rejected because neither corresponds to actual model requests. Rely
  on `recursionLimit` alone for the LLM-call metric; rejected because it limits
  graph supersteps, not model invocations.
- **References**:
  - [LangGraph JS graph API](https://docs.langchain.com/oss/javascript/langgraph/graph-api)
  - [LangGraph JS quickstart](https://docs.langchain.com/oss/javascript/langgraph/quickstart)
  - [LangGraph JS graph recursion handling](https://docs.langchain.com/oss/javascript/langgraph/use-graph-api)

## Decision 4: Use a JSON baseline and isolated in-memory tool stores

- **Decision**: `data/ops-store.json` is the prototype's seed database. Store
  creation validates and copies its services, alerts, and incidents into an
  isolated in-memory `OpsStore`. Tools can read existing alerts and add/resolve
  incidents in that store; run-time mutations do not write back to the baseline.
  `npm run seed` idempotently upserts canonical fixtures while preserving
  additional records. Sequelize v6 models remain available for future MySQL use.
- **Rationale**: The current request prioritizes JSON-only seed data and
  deterministic memory execution for tests and strategy runs, with no external
  database dependency.
- **Alternatives considered**: Connect each tool to MySQL; rejected for the
  current prototype because local tests and runs must work offline. Persist
  every tool mutation back to the shared JSON file; rejected to preserve
  isolation between tests and arena strategies.
- **References**:
  - [Sequelize v6 manual](https://sequelize.org/docs/v6/)
  - [Sequelize v6 model basics](https://sequelize.org/docs/v6/core-concepts/model-basics/)
  - [Sequelize v6 transactions](https://sequelize.org/docs/v6/other-topics/transactions/)

## Decision 5: Use Node's native environment-file support and existing TypeScript test runner

- **Decision**: Keep `.env` consumption on Node CLI invocations via
  `--env-file-if-exists=.env`; use the existing `tsx` loader and Node built-in
  test runner. The JSON seed does not consume environment variables.
- **Rationale**: This uses the project's established ESM setup and avoids adding
  dotenv or test dependencies. Node documents `--env-file-if-exists` from v22.9.
- **Alternatives considered**: Add dotenv or a separate test framework; rejected
  because both contradict existing project guidance/dependencies.
- **References**:
  - [Node.js v22.20 CLI documentation](https://nodejs.org/docs/latest-v22.x/api/cli.html#--env-file-if-existsfile)
  - [Node.js test runner](https://nodejs.org/docs/latest-v22.x/api/test.html)

## Resolved requirements boundary

The JSON baseline is validated and loaded into isolated in-memory stores; the
current seed script does not require MySQL. Sequelize model definitions remain
available but are not used by the prototype's tools, arena, or tests.

The existing Sequelize 6.37.8 package ships TypeScript declarations, so a
separate `@types/sequelize` dependency is unnecessary. The installed LangGraph
package exports the requested prebuilt ReAct API, but marks it deprecated in
favor of `langchain`; keep the usage isolated to make a later change explicit.
