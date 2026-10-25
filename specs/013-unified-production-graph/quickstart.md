# Quickstart: Unified Production Graph

## 1. Automated validation (fake router, fake strategies)

```bash
npm run typecheck
npm test
```

New coverage:

- `tests/graph/router.test.ts` — schema rejects unknown routes/empty reasons; router prompt
  contains the routing table for all three routes.
- `tests/graph/production-graph.test.ts` — fake router picks each route and only that
  strategy runs; override skips the router; router error / invalid output → `fallback` to
  `react`; every event has `node`; order summarize → route → strategy; router call counted.
- `tests/http/server.test.ts` — optional `strategy`, legacy `reflect` forms, unknown strategy
  422, `route` event in responses.

## 2. Live routing

```bash
npm run dev
curl -s localhost:3000/chat -X POST -H "Content-Type: application/json" \
  -d '{"message":"Abra incidentes para checkout e payments e resolva o primeiro"}' \
  | jq '[.trace[] | {type, node}], (.trace[] | select(.type=="route"))'
curl -s localhost:3000/chat -X POST -H "Content-Type: application/json" \
  -d '{"message":"Quais alertas estão disparando?","strategy":"react"}' \
  | jq '.trace[] | select(.type=="route")'
```

Expected (see [contracts/chat-routing.md](./contracts/chat-routing.md)): first call routed by
the model (`source: "router"`, likely `plan-and-execute`); second shows `source: "override"`.
