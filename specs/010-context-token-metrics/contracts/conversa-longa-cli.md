# Contract: `scripts/conversa-longa.sh`

Invocation: `bash scripts/conversa-longa.sh` or `npm run conversa-longa`.

## Inputs (environment variables)

| Variable | Default | Validation |
|----------|---------|------------|
| `OPSPILOT_URL` | `http://localhost:3000` | base URL; `/chat` is appended |
| `TURNS` | `10` | positive integer, else exit 2 with usage message |
| `STRATEGY` | `react` | passed through as `strategy` |

The script never reads `.env` and sends no credentials.

## Behavior

1. Turn 1 sends `{ message, strategy }` without `conversationId`; subsequent turns reuse the
   `conversationId` returned by turn 1.
2. Messages come from a fixed list of operational questions, cycled when `TURNS` exceeds it.
3. Each response is parsed with Node; only `conversationId` and `metrics` are read.

## Output (stdout), one line per turn

```text
turno  1  promptTokens=  812  estimado(history=0 memory=0 message=9 total=9)
turno  2  promptTokens= 1034  estimado(history=58 memory=0 message=11 total=69)
...
turno  8  promptTokens=indisponível  estimado(history=402 memory=0 message=10 total=412)
```

A header line with the URL, strategy and turn count is printed first.

## Exit status

| Code | When |
|------|------|
| 0 | all turns succeeded |
| 1 | connection failure, non-2xx response (body printed to stderr), or unparseable response |
| 2 | invalid `TURNS` |
