# Implementation Plan: Publicação da War Room no GitHub Pages

**Branch**: `017-web-pages-deploy` | **Date**: 2026-10-24 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/017-web-pages-deploy/spec.md`

## Summary

> **Revisão 2026-10-24:** o OpsPilot passou a ter repositório Git próprio
> ([`cyzop/opspilot`](https://github.com/cyzop/opspilot)). O workflow fica em
> `ops-pilot/.github/workflows/opspilot-web-pages.yml`, a base do build é `/<repositório>/`
> e o site é publicado em `https://cyzop.github.io/opspilot/` (o `web/dist` vai direto, sem
> `_site/opspilot/`). O que segue abaixo e cita o monorepo foi substituído por isto.


Publicar a War Room (`web/`) em
`https://unipds-engenharia-de-ia-aplicada.github.io/engenharia-de-software-com-ia-aplicada/opspilot/`
com um workflow do GitHub Actions na raiz do repositório
(`.github/workflows/opspilot-web-pages.yml`). Um job `build` (só `contents: read`) instala pelo
lockfile, roda typecheck, testes e build com a base `/<repo>/opspilot/` e envia `_site/` (com o
build em `_site/opspilot/`) via `actions/upload-pages-artifact`. Um job `deploy` (só
`pages: write` + `id-token: write`, ambiente `github-pages`) publica com `actions/deploy-pages` e
expõe `page_url`. A base do Vite passa a vir de `OPSPILOT_WEB_BASE` (padrão `/opspilot/`),
validada por uma função pura testada; o local não muda. Testes estáticos verificam o workflow
(gatilhos, permissões, actions fixadas por SHA, concorrência). README atualizado.

## Technical Context

**Language/Version**: TypeScript ESM (`strict`) no `web/`; YAML do GitHub Actions; Node.js 22 LTS no runner.

**Primary Dependencies**: Vite 8 (já usado); actions oficiais `actions/checkout@v7.0.1`,
`actions/setup-node@v7.1.0`, `actions/upload-pages-artifact@v5.0.0`,
`actions/deploy-pages@v5.0.1`, fixadas por SHA de commit (research R3). Nenhuma dependência npm nova.

**Storage**: N/A (artefato de Pages efêmero, retenção 1 dia).

**Testing**: `node:test` via `tsx` no `web/` (`npm test --prefix web`): função de base, build com
base customizada e verificação estática do workflow.

**Target Platform**: GitHub-hosted runner `ubuntu-latest`; site estático no GitHub Pages (HTTPS).

**Project Type**: web app estático (frontend) + automação de CI/CD.

**Performance Goals**: workflow completo (build + deploy) em menos de 10 min (SC-001); hoje
`npm ci` + testes + build do `web/` levam ~1–2 min.

**Constraints**: permissões mínimas (FR-004); nenhum secret (FR-011); publicação serializada sem
cancelar a em andamento (FR-005); local continua em `/opspilot/` (FR-008); workflow precisa ficar
em `.github/workflows/` da raiz do repositório.

**Scale/Scope**: 1 workflow, 1 função de configuração, 1 alteração em `vite.config.ts`, 2 arquivos de teste, README.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Avaliação |
|-----------|-----------|
| I. MVC e efeitos controlados | ✅ A regra de base é uma função pura (`resolveBase`); `vite.config.ts` só lê `process.env` na borda. Sem mudança na API. |
| II. Contratos validados com Zod | ✅ A entrada externa (`OPSPILOT_WEB_BASE`) é validada com Zod (`z.string().regex`) e erro claro. |
| III. Erros explícitos | ✅ Base inválida lança `Error` com mensagem em português que derruba o build (falha cedo no CI). |
| IV. Testes e qualidade contínua | ✅ Testes novos para a função, para o build com base customizada e para o workflow; o próprio workflow roda typecheck + testes antes de publicar. |
| V. Segurança e Spec Kit | ✅ Nenhum secret; `GITHUB_TOKEN` com escopos mínimos por job; actions fixadas por SHA; `persist-credentials: false` no checkout. Fluxo specify → plan → tasks → implement. |
| Stack | ✅ Node 22 LTS (`node-version: 22`), `package.json` como fonte dos scripts (`npm ci`, `typecheck`, `test`, `build`). |

Nenhuma violação; Complexity Tracking vazio.

**Re-check pós-design**: mantém-se ✅ — o contrato do workflow (contracts/pages-workflow.md) não
acrescenta permissões nem secrets; a verificação estática fixa isso em teste.

## Project Structure

### Documentation (this feature)

```text
specs/017-web-pages-deploy/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── pages-workflow.md
│   └── build-base.md
└── tasks.md             # /speckit-tasks
```

### Source Code

```text
<repo root>/.github/workflows/
└── opspilot-web-pages.yml          # NOVO: build + deploy do Pages

modulo04-criacao-de-agentes-autonomos-novo/ops-pilot/
├── README.md                        # ATUALIZADO: seção "Publicação no GitHub Pages"
└── web/
    ├── vite.config.ts               # base = resolveBase(process.env.OPSPILOT_WEB_BASE)
    ├── build-config.ts              # NOVO: resolveBase (pura, Zod), DEFAULT_BASE
    ├── tsconfig.json                # incluir build-config.ts / vite.config.ts se preciso
    └── tests/build/
        ├── base-path.test.ts        # ATUALIZADO: também com base customizada
        ├── build-config.test.ts     # NOVO: resolveBase
        └── pages-workflow.test.ts   # NOVO: verificação estática do workflow
```

**Structure Decision**: o workflow fica na raiz porque o GitHub só lê `.github/workflows/` de lá;
todo o resto fica dentro de `ops-pilot/web/`. `build-config.ts` fica ao lado do `vite.config.ts`
(é configuração de build, não código do app em `src/`).

## Complexity Tracking

Sem violações.
