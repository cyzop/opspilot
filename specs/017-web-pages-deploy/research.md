# Research: Publicação da War Room no GitHub Pages

Fontes: `action.yml` e README de cada action no branch `main` e a API pública do GitHub para as
releases (consultadas em 2026-10-24). O Context7 estava indisponível ("Invalid API key").

> **Revisão 2026-10-24:** o OpsPilot passou a ter repositório Git próprio
> ([`cyzop/opspilot`](https://github.com/cyzop/opspilot)). O workflow fica em
> `ops-pilot/.github/workflows/opspilot-web-pages.yml`, a base do build é `/<repositório>/`
> e o site é publicado em `https://cyzop.github.io/opspilot/` (o `web/dist` vai direto, sem
> `_site/opspilot/`). O que segue abaixo e cita o monorepo foi substituído por isto.

## R1 — Pacote do site e caminho publicado

- **Decision**: o build sai em `web/dist`; o workflow copia para `_site/opspilot/` e envia
  `_site/` com `actions/upload-pages-artifact` (`path: _site`). O site do repositório fica com só a
  pasta `opspilot/`; a raiz responde 404 (livre para outros módulos, como decidido na spec).
- **Rationale**: o Pages de projeto serve em `/<repo>/`; colocar o build em `opspilot/` dá o
  caminho escolhido (`…/engenharia-de-software-com-ia-aplicada/opspilot/`) sem truques de redirect.
- **Alternatives**: publicar `web/dist` direto (site em `/<repo>/`, contra a decisão Q1); página
  índice na raiz (fora de escopo, ocuparia a raiz).

## R2 — Como o build descobre a base

- **Decision**: `vite.config.ts` usa `resolveBase(process.env.OPSPILOT_WEB_BASE)`; padrão
  `/opspilot/`. O workflow define `OPSPILOT_WEB_BASE: /${{ github.event.repository.name }}/opspilot/`.
- **Rationale**: sem domínio próprio, o caminho de Pages de projeto é sempre `/<nome-do-repo>/`;
  ler o nome do evento não precisa de permissão nenhuma.
- **Alternatives**: `actions/configure-pages` (saída `base_path`) — exigiria `pages: read` no job
  de build, fugindo das 3 permissões do FR-004, e só ajuda com domínio próprio (fora de escopo).
  Fica documentado como evolução se um domínio for configurado.

## R3 — Versões e fixação das actions

- **Decision** (releases mais recentes em 2026-10-24, fixadas por SHA com a tag em comentário):

  | Action | Tag | SHA |
  |--------|-----|-----|
  | `actions/checkout` | v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
  | `actions/setup-node` | v7.1.0 | `949feb2413d6458794dcd2491c4babbbce0c15c1` |
  | `actions/upload-pages-artifact` | v5.0.0 | `fc324d3547104276b827a68afc52ff2a11cc49c9` |
  | `actions/deploy-pages` | v5.0.1 | `368f82528645a54fb793d4d04e342629a3f51346` |

- **Rationale**: SHA é imutável (tag pode ser movida); atende FR-009 e é a recomendação de
  hardening do GitHub. O comentário `# vX.Y.Z` mantém legível e permite Dependabot.
- **Alternatives**: tags de major (`@v7`) como o workflow de skills existente — mais simples, mas
  não fixa a versão.

## R4 — Permissões

- **Decision**: `permissions: {}` no topo; job `build`: `contents: read`; job `deploy`:
  `pages: write` e `id-token: write`. Checkout com `persist-credentials: false`.
- **Rationale**: o README do `deploy-pages` exige exatamente `pages: write` (criar o deploy) e
  `id-token: write` (token OIDC que prova a origem). O build só lê o código. Escopo por job reduz o
  que um passo comprometido do build poderia fazer.
- **Alternatives**: permissões no topo para os dois jobs (padrão do starter do GitHub) — dá
  `pages: write` ao build sem necessidade.

## R5 — Gatilhos e concorrência

- **Decision**: `push` em `main` com `paths` = `modulo04-criacao-de-agentes-autonomos-novo/ops-pilot/web/**`
  e o próprio arquivo do workflow; `workflow_dispatch`. `concurrency: { group: opspilot-pages,
  cancel-in-progress: false }`. Sem `pull_request`.
- **Rationale**: cumpre FR-001/FR-005 e SC-004; não cancelar evita deploy pela metade (recomendação
  do starter de Pages). Execuções enfileiradas: o GitHub mantém só a mais recente pendente, então o
  site termina com a última versão.
- **Alternatives**: `cancel-in-progress: true` (pode interromper um deploy); PR com build sem
  deploy (útil, mas fora de escopo; pode virar outro workflow).

## R6 — Node, instalação e cache

- **Decision**: `actions/setup-node` com `node-version: 22`, `cache: npm`,
  `cache-dependency-path: …/ops-pilot/web/package-lock.json`; `npm ci`; depois `npm run typecheck`,
  `npm test`, `npm run build` com `working-directory` no `web/`.
- **Rationale**: constituição exige Node 22 LTS e `package.json` como fonte dos scripts; `npm ci`
  é reproduzível pelo lockfile (FR-002). `npm test` já inclui o teste de build com base.
- **Alternatives**: `lts/*` (hoje Node 24; diverge da constituição).

## R7 — Ambiente e URL publicada

- **Decision**: job `deploy` com `environment: { name: github-pages, url: ${{ steps.deployment.outputs.page_url }}opspilot/ }`.
- **Rationale**: `page_url` é a raiz do site (`…/engenharia-de-software-com-ia-aplicada/`); somar
  `opspilot/` mostra o link certo na execução e no ambiente (FR-006). O ambiente `github-pages` é o
  recomendado e é criado com proteção para `main` quando o Pages usa "GitHub Actions".

## R8 — Verificar o workflow sem rodar o GitHub

- **Decision**: teste `web/tests/build/pages-workflow.test.ts` lê o YAML como texto e confere:
  gatilhos e `paths`, `permissions: {}` no topo, permissões por job, toda `uses:` fixada por SHA de
  40 hex com comentário de versão, concorrência sem cancelamento, `node-version: 22`,
  `OPSPILOT_WEB_BASE`, `path: _site`, e ausência de `secrets.`.
- **Rationale**: não há parser YAML nas dependências; checagens por texto/regex bastam para os
  invariantes de segurança e evitam dependência nova. `actionlint` pode ser rodado localmente se
  instalado (opcional, documentado no quickstart).
- **Alternatives**: adicionar `yaml` como devDependency (mais robusto, mas dependência nova só para
  um teste).

## R9 — HTTPS do Pages × API local

- **Decision**: documentar no README: a War Room publicada (HTTPS) pode chamar
  `http://localhost:3000` (navegadores tratam `localhost` como contexto seguro; o Chrome pode pedir
  permissão de "acesso à rede local"); uma API remota precisa de HTTPS. A API precisa de
  `OPSPILOT_CORS_ORIGINS` com `https://unipds-engenharia-de-ia-aplicada.github.io` (origem = esquema
  + host, sem caminho).
- **Rationale**: é a causa mais provável de "Não foi possível conectar à API (rede ou CORS)" após
  publicar.
