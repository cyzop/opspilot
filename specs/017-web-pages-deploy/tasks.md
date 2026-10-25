---

description: "Task list for feature 017 — Publicação da War Room no GitHub Pages"
---

# Tasks: Publicação da War Room no GitHub Pages

**Input**: Design documents from `specs/017-web-pages-deploy/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Incluídos — a constituição (princípio IV) exige testes junto com a lógica nova; testes vêm antes da implementação.

**Organization**: Tarefas agrupadas por user story para entrega e teste independentes.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência pendente)
- **[Story]**: US1, US2, US3 (de spec.md)

> **Revisão 2026-10-24:** o OpsPilot virou repositório próprio (`cyzop/opspilot`). `REPO`, `OPS` e
> `WEB` abaixo descrevem o desenho original; a T016 registra a mudança para o novo repositório.

## Path Conventions

- `REPO` = raiz do git (`engenharia-de-software-com-ia-aplicada/`).
- `OPS` = `modulo04-criacao-de-agentes-autonomos-novo/ops-pilot/` (caminhos sem prefixo são relativos a `OPS`).
- `WEB` = `modulo04-criacao-de-agentes-autonomos-novo/ops-pilot/web` (como aparece no workflow).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Preparar o `web/` para ter configuração de build testável.

- [X] T001 Add `build-config.ts` to the `include` array of `web/tsconfig.json` (today `["src", "tests", "vite.config.ts"]`) so `npm run typecheck --prefix web` covers it

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Base do build configurável — o workflow (US1/US2) depende dela.

**⚠️ CRITICAL**: Nenhuma user story começa antes desta fase.

- [X] T002 [P] Write `web/tests/build/build-config.test.ts` for `resolveBase(raw)` per `contracts/build-base.md`: `undefined`, `""`, `"  "` → `/opspilot/`; `/opspilot/` and `/engenharia-de-software-com-ia-aplicada/opspilot/` unchanged; `" /x/ "` → `/x/`; each of `opspilot/`, `/opspilot`, `https://x/`, `/a//b/`, `/a/../b/`, `/a b/`, `/a?x/`, `/a#x/` throws an `Error` whose message contains "OPSPILOT_WEB_BASE inválida"; `DEFAULT_BASE === "/opspilot/"`
- [X] T003 Create `web/build-config.ts` exporting `DEFAULT_BASE = "/opspilot/"` and pure `resolveBase(raw: string | undefined): string`: trimmed empty/absent → default; otherwise validated with Zod `z.string().regex(/^\/([A-Za-z0-9._-]+\/)*$/)` plus rejecting any `..` segment; on failure throw `new Error("OPSPILOT_WEB_BASE inválida: \"<valor>\". Use algo como /opspilot/.")`; make T002 pass
- [X] T004 Change `web/vite.config.ts` to `base: resolveBase(process.env.OPSPILOT_WEB_BASE)` (import from `./build-config.ts`); keep `server`/`preview` ports; confirm `npm run dev --prefix web` still serves `http://localhost:5173/opspilot/`
- [X] T005 Extend `web/tests/build/base-path.test.ts`: keep the default-base test, and add a test that runs Vite `build()` with `process.env.OPSPILOT_WEB_BASE = "/engenharia-de-software-com-ia-aplicada/opspilot/"` (restore the previous value in `context.after`) into a temp dir and asserts every `<script src>`/`<link href>` in `index.html` starts with that prefix and the referenced file exists under the temp dir

**Checkpoint**: `npm run typecheck --prefix web && npm test --prefix web` verdes; build local idêntico ao de hoje.

---

## Phase 3: User Story 1 - Publicação automática a cada mudança aprovada (Priority: P1) 🎯 MVP

**Goal**: Push na `main` que mude `ops-pilot/web/` verifica e publica a War Room em `…/engenharia-de-software-com-ia-aplicada/opspilot/`; falha de teste/typecheck não publica.

**Independent Test**: Push na `main` alterando um texto da War Room → execução verde com link `…/opspilot/`; página carrega sem 404. Push só fora de `web/` → nenhuma execução.

### Tests for User Story 1 ⚠️

- [X] T006 [P] [US1] Write `web/tests/build/pages-workflow.test.ts` reading `../../../../../.github/workflows/opspilot-web-pages.yml` (resolve from `import.meta.url`) as text, per `contracts/pages-workflow.md`: `on.push.branches` has `main`; `paths` has `modulo04-criacao-de-agentes-autonomos-novo/ops-pilot/web/**` and `.github/workflows/opspilot-web-pages.yml`; no `pull_request`, `pull_request_target` or `schedule`; top-level `permissions: {}`; job `build` permissions exactly `contents: read`; job `deploy` permissions exactly `pages: write` and `id-token: write`; no `secrets.` anywhere; every `uses:` line matches `/^\s*(-\s*)?uses:\s*actions\/[a-z-]+@[0-9a-f]{40}\s+#\s*v\d+\.\d+\.\d+\s*$/`; the four actions are checkout, setup-node, upload-pages-artifact, deploy-pages; `persist-credentials: false`; `node-version: 22`; `cache-dependency-path` points at `WEB/package-lock.json`; steps run `npm ci`, `npm run typecheck`, `npm test`, `npm run build` in that order with `working-directory: WEB`; `OPSPILOT_WEB_BASE: /${{ github.event.repository.name }}/opspilot/`; `path: _site`; `deploy` has `needs: build`, `environment` `name: github-pages` and `url: ${{ steps.deployment.outputs.page_url }}opspilot/`, and step `id: deployment`

### Implementation for User Story 1

- [X] T007 [US1] Create `REPO/.github/workflows/opspilot-web-pages.yml` (name "OpsPilot War Room — Pages") per `contracts/pages-workflow.md` with the SHAs from `research.md` R3: `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1`, `actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0`, `actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9 # v5.0.0`, `actions/deploy-pages@368f82528645a54fb793d4d04e342629a3f51346 # v5.0.1`; `push` trigger with the `paths` filter; `permissions: {}`; job `build` (`ubuntu-latest`, `timeout-minutes: 10`, `contents: read`): checkout → setup-node → `npm ci` → `npm run typecheck` → `npm test` → `npm run build` (env `OPSPILOT_WEB_BASE`) → `mkdir -p _site/opspilot && cp -R WEB/dist/. _site/opspilot/` → upload `path: _site`; job `deploy` (`needs: build`, `timeout-minutes: 10`, `pages: write`, `id-token: write`, environment `github-pages` with the `opspilot/` URL) → `id: deployment` deploy-pages; make T006 pass
- [X] T008 [US1] Run locally `OPSPILOT_WEB_BASE=/engenharia-de-software-com-ia-aplicada/opspilot/ npm run build --prefix web` and then the T007 assembly commands into a scratch `_site/` (outside the repo), confirming `_site/opspilot/index.html` references only `/engenharia-de-software-com-ia-aplicada/opspilot/…` files that exist; delete the scratch output

**Checkpoint**: workflow pronto para o primeiro push; contrato verificado por teste.

---

## Phase 4: User Story 2 - Publicação manual sob demanda (Priority: P2)

**Goal**: Disparo manual na `main`; publicações serializadas sem cancelar a em andamento.

**Independent Test**: "Run workflow" na `main` publica; dois disparos seguidos → o segundo espera e o site termina com a última versão.

### Tests for User Story 2 ⚠️

- [X] T009 [US2] Extend `web/tests/build/pages-workflow.test.ts`: `on` has `workflow_dispatch` (no `inputs`); top-level `concurrency` with `group: opspilot-pages` and `cancel-in-progress: false`

### Implementation for User Story 2

- [X] T010 [US2] Add `workflow_dispatch:` and the top-level `concurrency` block to `REPO/.github/workflows/opspilot-web-pages.yml`; make T009 pass

**Checkpoint**: US1 e US2 completas no mesmo arquivo; testes verdes.

---

## Phase 5: User Story 3 - Documentação para publicar e usar o site (Priority: P3)

**Goal**: README explica endereço, ativação do Pages, gatilhos, CORS e HTTPS.

**Independent Test**: Seguindo só o README, alguém ativa o Pages, publica, abre o site e conversa com a sua API.

### Implementation for User Story 3

- [X] T011 [US3] Update `README.md` section "War Room (`web/`)": replace the generic "publique `web/dist` em `/opspilot/` de qualquer host" bullet with a subsection "Publicação no GitHub Pages": endereço `https://unipds-engenharia-de-ia-aplicada.github.io/engenharia-de-software-com-ia-aplicada/opspilot/`; ativação única (Settings → Pages → Source: GitHub Actions); gatilhos (push na `main` mudando `ops-pilot/web/**` ou o workflow; manual em Actions → "OpsPilot War Room — Pages" → Run workflow); o que o workflow faz (typecheck, testes, build; falha não publica; uma publicação por vez); permissões (`contents: read` no build; `pages: write` + `id-token: write` no deploy; sem secrets); `OPSPILOT_WEB_BASE` (padrão `/opspilot/`, só o workflow muda); `OPSPILOT_CORS_ORIGINS` deve incluir `https://unipds-engenharia-de-ia-aplicada.github.io` (só esquema + host, nunca `*`); aviso HTTPS: `http://localhost:3000` funciona (o Chrome pode pedir acesso à rede local), API remota precisa de HTTPS
- [X] T012 [P] [US3] Add the GitHub Pages origin as a commented example in `.env.example` next to `OPSPILOT_CORS_ORIGINS` (e.g. `# OPSPILOT_CORS_ORIGINS=http://localhost:5173,https://unipds-engenharia-de-ia-aplicada.github.io`), without touching `.env`

**Checkpoint**: Documentação completa.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T013 Run `npm run typecheck --prefix web && npm test --prefix web && npm run build --prefix web` and the root `npm run typecheck && npm test` (only the pre-existing `forget_preference` failure and the 2 `learning-reflection` type errors may remain); fix any failure
- [X] T014 [P] If `actionlint` is installed, run it on `REPO/.github/workflows/opspilot-web-pages.yml`; otherwise record in this file that it was skipped
  - Pulada: `actionlint` não está instalado nesta máquina (2026-10-24). O contrato é coberto por `web/tests/build/pages-workflow.test.ts`.
- [ ] T015 Run quickstart.md steps 2–6 on GitHub (requires repo admin to enable Pages and a push to `main`, which needs the user's manual approval); left to the user — record the outcome in this file
  - Pendente (usuário): criar o repositório `cyzop/opspilot` no GitHub se ainda não existir, ativar o Pages (Source: GitHub Actions), aprovar o push da `main` e seguir o quickstart passos 2–6.

- [X] T016 Move the workflow to the standalone repo `cyzop/opspilot`: `ops-pilot/.github/workflows/opspilot-web-pages.yml` with `paths: web/**`, `working-directory: web`, `OPSPILOT_WEB_BASE: /${{ github.event.repository.name }}/`, `path: web/dist` and environment `url: page_url`; remove the monorepo-root copy; update `pages-workflow.test.ts` (path `../../../.github/…`, `WEB = "web"`), README, `.env.example` (origin `https://cyzop.github.io`), contracts, quickstart, spec, plan, research and data-model; site at `https://cyzop.github.io/opspilot/`

---

## Dependencies & Execution Order

### Phase Dependencies

- Setup (T001) → Foundational (T002–T005) → US1 (T006–T008) → US2 (T009–T010) → Polish.
- US3 (T011–T012) depende só do desenho (pode rodar após a Foundational, em paralelo a US1/US2).

### User Story Dependencies

- **US1**: depende da base configurável (Phase 2).
- **US2**: edita o mesmo workflow de US1 → depois de US1.
- **US3**: independente do código; descreve o comportamento de US1/US2.

### Within Each User Story

- Teste antes da implementação (T006 → T007, T009 → T010); T002 → T003.

### Parallel Opportunities

- T002 em paralelo com T001.
- T006 (teste do workflow) em paralelo com T004/T005 após T003.
- T011 e T012 em paralelo entre si e com US1/US2.
- T014 em paralelo com T013.

## Parallel Example: User Story 1

```text
Task: "T006 Write web/tests/build/pages-workflow.test.ts"
Task: "T011 Update README.md Publicação no GitHub Pages"   # US3, arquivo diferente
```

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 + 2 (base configurável, local intacto).
2. US1: workflow com push filtrado → validar com o primeiro push na `main` (após ativar o Pages).

### Incremental Delivery

1. MVP (US1) → publicação automática.
2. US2 → disparo manual + concorrência.
3. US3 → README e `.env.example`.

### Parallel Team Strategy

- Dev A: T001–T005 → T006–T010.
- Dev B: T011–T012 em paralelo.

## Notes

- Não fazer commit nem push sem pedido explícito; `git push` exige aprovação manual.
- Nunca ler nem imprimir `.env`.
