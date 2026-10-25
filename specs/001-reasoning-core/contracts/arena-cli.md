# Contract: Arena CLI

## Invocation

The arena accepts one positional operator input and these options:

- `--strategies <names>`: comma-separated list of `react` and
  `plan-and-execute`; default is both strategies.
- `--max-iterations <positive-integer>`: shared per-strategy reasoning bound;
  maximum LLM invocations per strategy (planner and replanner included); default
  is 8.
- `--help`: print usage without constructing a model or accessing external services.

The arena creates each selected strategy with the same input and the selected
iteration limit. Give each strategy a fresh clone of the same seeded in-memory
baseline so one strategy's incident mutations cannot influence another result.
Run selected strategies in selection order to keep output and shared resources
predictable.

## Output

For each strategy, print its name, final answer, ordered trace events, LLM-call
count, and elapsed milliseconds. Keep result groups distinct and deterministic
in selected strategy order.

## Errors and exit status

- Missing positional input, empty/unknown/duplicate strategy names, and malformed
  iteration limits produce a usage error and non-zero exit status.
- Missing OpenRouter configuration and model/tool failures produce a visible
  error and non-zero exit status; do not print secrets or substitute successful
  results.
- The arena does not require MySQL; it uses the seeded in-memory store.
