# Quickstart: Persisted Request Trace and JSON Logs

Validation guide. Contracts: [http-requests.md](./contracts/http-requests.md),
[log-events.md](./contracts/log-events.md); tables and schemas: [data-model.md](./data-model.md).

## Prerequisites

- Node.js 22 LTS, `npm install` done.
- `.env` configured for live checks (do not print it).

## 1. Automated checks (no provider calls, `:memory:` database)

```bash
npm run typecheck
npm test
```

Expected coverage:

| Scenario | Expected |
|----------|----------|
| successful `/chat` | `X-Request-Id` header = body `requestId`, UUID |
| each error status (400 schema, 400 malformed JSON, 404, 422, 503, 504, 500) | header + `requestId` in the error body, status unchanged |
| client sends `X-Request-Id` | ignored, server id returned |
| 100 requests | 100 distinct ids |
| lookup after success | record metrics = response metrics; trace = response trace, same order and nodes |
| lookup after 503 / 504 | status + category, `metrics: null`, partial trace |
| unknown / malformed id | 404 / 400 |
| store write throws | chat still 200 with `requestId`; `persistence_failed` log; lookup 404 |
| reopen database file | record and trace still returned |
| captured logs for one turn | every line valid JSON; `request_started`, one `trace_event` per event, `request_finished`; no `content`/`reason`/`answer`/`args` keys and no message text |

## 2. Live check

```bash
npm run dev 2> logs.jsonl
curl -si -X POST http://localhost:3000/chat -H "Content-Type: application/json" \
  -d '{"message":"Quais alertas estão abertos?"}'
```

Expected: `X-Request-Id: <uuid>` header and the same `requestId` in the body.

```bash
curl -s http://localhost:3000/requests/<uuid>
```

Expected: `request` with `status: 200` and metrics; `trace` identical to the chat response.

```bash
grep '"requestId":"<uuid>"' logs.jsonl
```

Expected: `request_started`, one `trace_event` per trace event, `request_finished`; no answer
text. Stop the server, start it again and repeat the `GET` — same result.

## 3. Lookup errors

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/requests/not-a-uuid                              # 400
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/requests/00000000-0000-4000-8000-000000000000    # 404
```

Remove `logs.jsonl` afterwards.
