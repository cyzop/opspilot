# Contract: `.github/workflows/opspilot-web-pages.yml`

Arquivo na raiz do repositório `cyzop/opspilot` (a pasta `ops-pilot/`). Abaixo, as propriedades
que `web/tests/build/pages-workflow.test.ts` verifica. `WEB` = `web`.

> Revisão 2026-10-24: antes o workflow ficava na raiz do monorepo e publicava em
> `…/engenharia-de-software-com-ia-aplicada/opspilot/` via `_site/opspilot/`. Substituído por este.

## Gatilhos

- `push` em `branches: [main]` com `paths`: `web/**` e `.github/workflows/opspilot-web-pages.yml`.
- `workflow_dispatch` (sem inputs).
- Nenhum `pull_request`, `pull_request_target` ou `schedule`.

## Permissões

- Topo: `permissions: {}`.
- Job `build`: `contents: read` (nada mais).
- Job `deploy`: `pages: write` e `id-token: write` (nada mais).
- Nenhuma referência a `secrets.` no arquivo.

## Concorrência

```yaml
concurrency:
  group: opspilot-pages
  cancel-in-progress: false
```

## Job `build` (`runs-on: ubuntu-latest`, `timeout-minutes: 10`)

1. `actions/checkout@<sha> # v7.0.1` com `persist-credentials: false`.
2. `actions/setup-node@<sha> # v7.1.0` com `node-version: 22`, `cache: npm`,
   `cache-dependency-path: web/package-lock.json`.
3. `npm ci` → `npm run typecheck` → `npm test` → `npm run build`, todos com
   `working-directory: web`; o build com `env.OPSPILOT_WEB_BASE: /${{ github.event.repository.name }}/`.
4. `actions/upload-pages-artifact@<sha> # v5.0.0` com `path: web/dist`.

## Job `deploy` (`needs: build`, `runs-on: ubuntu-latest`, `timeout-minutes: 10`)

- `environment: { name: github-pages, url: ${{ steps.deployment.outputs.page_url }} }`.
- Passo `id: deployment`: `actions/deploy-pages@<sha> # v5.0.1`.

## Fixação

- Toda linha `uses:` = `owner/repo@<40 hex> # vX.Y.Z`. SHAs em [research.md](../research.md#r3--versões-e-fixação-das-actions).

## Resultado

- Sucesso: site em `https://cyzop.github.io/opspilot/`.
- Falha em qualquer passo do `build`: `deploy` não roda; versão anterior continua no ar.
