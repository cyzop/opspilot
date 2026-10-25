# Quickstart: War Room Web

## Prerequisites

- Node.js 22, dependencies installed at the root (`npm install`) and in `web/`
  (`npm install --prefix web`).
- `.env` with the OpenRouter settings already used by `npm run dev` (do not print it).

## Automated checks

```bash
npm run typecheck && npm test                 # API: approvals, CORS, 202 flow
npm run typecheck --prefix web && npm test --prefix web   # web: lib + components + axe
```

Expected: all green, except the pre-existing `forget_preference` failure in
`tests/learning-reflection.test.ts`.

## Manual run

```bash
npm run dev                    # API on http://localhost:3000
npm run dev --prefix web       # war room on http://localhost:5173/opspilot/
```

1. **Chat (US1)**: open `http://localhost:5173/opspilot/` → empty state with examples. Click
   "Quais alertas estão ativos?" → loading skeleton, then the answer. Send a follow-up → same
   conversation.
2. **Trace (US2)**: click "Ver raciocínio" → ordered steps (Rota, Ação `list_alerts`,
   Observação, Resposta) and the metrics summary.
3. **Approval (US3)**: the seed has no incidents, so first ask "Abra um incidente para o
   alerta alert-checkout-errors" (runs without approval, returns e.g. `incident-001`). Then ask
   "Resolva o incidente incident-001" → 202 → card "Aprovação
   necessária". `Negar` → "Negado", incident still open (`GET` via chat: "liste incidentes").
   Ask again → `Aprovar` → "Aprovado" and the final answer; the incident is resolved.
   Checking with curl:

   ```bash
   curl -si -X POST localhost:3000/chat -H 'content-type: application/json' \
     -d '{"message":"Resolva o incidente incident-001"}' | head -1   # HTTP/1.1 202
   ```
4. **Settings (US4)**: gear → type `ftp://x` → error next to the field; type
   `http://localhost:3000` → "Testar conexão" → "Conectado" → Salvar → reload → still used.
5. **Base path + CORS (US5)**:

   ```bash
   npm run build --prefix web && npm run preview --prefix web   # serves /opspilot/
   curl -si -X OPTIONS localhost:3000/chat -H 'Origin: http://localhost:5173' \
     -H 'Access-Control-Request-Method: POST' | grep -i access-control
   curl -si localhost:3000/stats -H 'Origin: http://evil.example' | grep -ci access-control  # 0
   ```
6. **Dark mode / a11y**: switch the OS theme and the in-page toggle; navigate everything with
   Tab/Enter/Esc only.

## Contracts

- HTTP: [contracts/http-api.md](./contracts/http-api.md)
- UI: [contracts/web-ui.md](./contracts/web-ui.md)
- Data: [data-model.md](./data-model.md)
