# Feature Specification: Publicação da War Room no GitHub Pages

**Feature Branch**: `017-web-pages-deploy`
**Created**: 2026-10-24
**Status**: Draft
**Input**: User description: "Deploy do web/ no Pages via Actions: upload-pages-artifact + deploy-pages, permissions, README (atualizar)"

## Contexto

> **Revisão 2026-10-24:** o OpsPilot passou a ter repositório Git próprio
> ([`cyzop/opspilot`](https://github.com/cyzop/opspilot)). O workflow fica em
> `ops-pilot/.github/workflows/opspilot-web-pages.yml`, a base do build é `/<repositório>/`
> e o site é publicado em `https://cyzop.github.io/opspilot/` (o `web/dist` vai direto, sem
> `_site/opspilot/`). O que segue abaixo e cita o monorepo foi substituído por isto.

A War Room (`web/`, feature 016) hoje só roda localmente (`npm run dev --prefix web` ou
`preview`). O plantonista quer abrir a War Room por um endereço público fixo, sem instalar
nada, apontando a engrenagem para a API que estiver usando. O OpsPilot é uma subpasta
(`modulo04-criacao-de-agentes-autonomos-novo/ops-pilot/`) de um repositório maior
(`unipds-engenharia-de-ia-aplicada/engenharia-de-software-com-ia-aplicada`), e a publicação
acontece pelo GitHub Pages desse repositório, via uma automação do próprio GitHub.

## Clarifications

### Session 2026-10-24

- Q: Em qual endereço a War Room fica publicada? → A: `https://unipds-engenharia-de-ia-aplicada.github.io/engenharia-de-software-com-ia-aplicada/opspilot/`; a raiz do Pages do repositório fica livre.
- Q (revisão): Com o OpsPilot em repositório próprio (`cyzop/opspilot`), qual endereço? → A: `https://cyzop.github.io/opspilot/` (raiz do Pages do novo repositório).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Publicação automática a cada mudança aprovada (Priority: P1)

O mantenedor junta na branch principal uma mudança em `ops-pilot/web/`. Sem nenhum passo
manual, a automação verifica a War Room (typecheck, testes e build) e, se tudo passar, publica a
nova versão no endereço público. O plantonista abre o endereço e vê a versão nova.

**Why this priority**: É o objetivo da feature; sem isso não há War Room acessível fora da
máquina do desenvolvedor.

**Independent Test**: Fazer um push na branch principal alterando um texto visível da War Room;
acompanhar a execução até o fim e abrir o endereço publicado, que mostra o texto novo e carrega
todos os arquivos (sem erro 404 no navegador).

**Acceptance Scenarios**:

1. **Given** uma mudança em `ops-pilot/web/` na branch principal, **When** a automação termina,
   **Then** o endereço publicado serve a nova versão e a execução mostra o link do site.
2. **Given** uma mudança que quebra os testes ou o typecheck da War Room, **When** a automação
   roda, **Then** nada é publicado e a versão anterior continua no ar.
3. **Given** uma mudança só fora de `ops-pilot/web/` (por exemplo, em outro módulo do
   repositório), **When** ela chega à branch principal, **Then** a publicação não roda.
4. **Given** a página publicada, **When** o plantonista a abre, **Then** todos os scripts, estilos
   e ícones carregam a partir do endereço publicado e a War Room funciona igual à versão local.

---

### User Story 2 - Publicação manual sob demanda (Priority: P2)

O mantenedor dispara a publicação manualmente pela interface do GitHub (por exemplo, para
republicar após configurar o Pages pela primeira vez), sem precisar de um commit novo.

**Why this priority**: Necessário na primeira configuração e para recuperar o site, mas o fluxo
diário é o automático.

**Independent Test**: Disparar a automação manualmente na branch principal e confirmar que ela
verifica, publica e mostra o link do site.

**Acceptance Scenarios**:

1. **Given** o Pages configurado para publicar via automação, **When** o mantenedor dispara a
   execução manual, **Then** a versão atual da branch principal é verificada e publicada.
2. **Given** duas publicações disparadas quase juntas, **When** ambas rodam, **Then** só uma
   publica por vez e o site termina com a versão mais recente, sem publicação parcial.

---

### User Story 3 - Documentação para publicar e usar o site (Priority: P3)

Um novo mantenedor lê o README e descobre: o endereço público, como ativar o Pages no
repositório (uma vez), quando a publicação roda, como dispará-la manualmente e o que configurar
na API (origem permitida) para a War Room publicada conseguir conversar com ela.

**Why this priority**: Sem a documentação, a primeira publicação falha (Pages não ativado) ou a
War Room publicada não consegue falar com a API (origem bloqueada).

**Independent Test**: Seguindo só o README, alguém que nunca configurou o projeto ativa o Pages,
publica, abre o site, aponta a engrenagem para a sua API e recebe uma resposta.

**Acceptance Scenarios**:

1. **Given** o README atualizado, **When** o leitor procura como publicar, **Then** encontra o
   endereço público, o passo único de ativação do Pages, o gatilho automático e o manual.
2. **Given** a War Room publicada e a API local, **When** o leitor segue o README, **Then** sabe
   que precisa incluir a origem do site publicado em `OPSPILOT_CORS_ORIGINS` (sem `*`).

### Edge Cases

- **Pages não ativado no repositório**: a etapa de publicação falha com uma mensagem clara; o
  README explica o passo de ativação (fonte "GitHub Actions").
- **Site em HTTPS falando com API em `http://localhost`**: navegadores tratam `localhost` como
  origem confiável, mas podem pedir permissão de acesso à rede local; uma API remota precisa de
  HTTPS para não ser bloqueada como conteúdo misto. O README avisa isso.
- **Endereço publicado sob um subcaminho**: o site não fica na raiz do domínio; todos os
  arquivos e a navegação precisam funcionar sob o subcaminho publicado, e o desenvolvimento
  local continua em `http://localhost:5173/opspilot/`.
- **O repositório já publica outra coisa no Pages**: o repositório só tem um site Pages; esta
  automação passa a ser a dona dele. Hoje nenhum outro workflow publica no Pages.
- **Mudança só em arquivos de documentação do web/** (ex. README dentro de `web/`): a publicação
  roda mesmo assim (filtro por pasta), o que é aceitável.
- **Falha de rede ao instalar dependências**: a execução falha sem publicar; basta rodar de novo.
- **Segredos**: a publicação não usa nenhum secret próprio; a War Room publicada não contém
  chaves nem URLs privadas (a URL da API é escolhida por cada operador no navegador).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O repositório MUST ter uma automação de publicação da War Room que roda em push
  para a branch principal quando mudam arquivos em `ops-pilot/web/` ou a própria definição da
  automação, e também por disparo manual.
- **FR-002**: Antes de publicar, a automação MUST instalar as dependências de forma
  reproduzível (pelo lockfile) e rodar typecheck, testes e build da War Room; qualquer falha
  MUST impedir a publicação.
- **FR-003**: A automação MUST separar verificação/build de publicação: o build gera o pacote do
  site e a publicação só usa esse pacote.
- **FR-004**: A automação MUST pedir apenas as permissões mínimas: leitura do conteúdo, escrita
  no Pages e o token de identidade exigido pela publicação; nenhuma outra permissão de escrita.
- **FR-005**: Publicações MUST ser serializadas: no máximo uma em andamento; uma publicação em
  andamento não é cancelada no meio por outra.
- **FR-006**: Ao terminar, a execução MUST expor o endereço do site publicado (visível na
  execução e no ambiente de publicação do repositório).
- **FR-007**: O site publicado MUST servir todos os arquivos da War Room a partir do endereço
  público em `https://cyzop.github.io/opspilot/`, sem 404 em scripts ou estilos.
- **FR-008**: O build local e o de desenvolvimento MUST continuar funcionando como hoje
  (`http://localhost:5173/opspilot/` e preview em `http://localhost:4173/opspilot/`); a base do
  site publicado é escolhida só pela automação.
- **FR-009**: A automação MUST usar a versão de Node do projeto (22 LTS) e versões fixadas das
  ações que usa.
- **FR-010**: O README do OpsPilot MUST ser atualizado com: endereço público; ativação única do
  Pages (fonte "GitHub Actions"); quando a publicação roda e como dispará-la manualmente; a
  origem a adicionar em `OPSPILOT_CORS_ORIGINS` (só esquema + host, ex.
  `https://cyzop.github.io`, nunca `*`); e o aviso sobre HTTPS/API
  local.
- **FR-011**: A automação MUST NOT usar nem expor secrets do projeto (nada de `.env`, chaves do
  OpenRouter ou tokens extras).

### Key Entities

- **Automação de publicação**: definição versionada no repositório; gatilhos (push filtrado por
  pasta, manual), permissões, etapas de verificação e publicação.
- **Pacote do site**: resultado do build da War Room com a base do endereço publicado; é a única
  coisa enviada ao Pages.
- **Ambiente de publicação**: registro no GitHub da versão publicada e do seu endereço.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Uma mudança na War Room juntada na branch principal está no ar em até 10 minutos,
  sem nenhum passo manual.
- **SC-002**: 100% das execuções com testes ou typecheck falhando terminam sem publicar.
- **SC-003**: A página publicada carrega com zero respostas 404 para os próprios arquivos e
  funciona nos mesmos fluxos da versão local (chat, ver raciocínio, aprovar/negar, engrenagem).
- **SC-004**: Mudanças fora de `ops-pilot/web/` não disparam nenhuma publicação.
- **SC-005**: Um mantenedor novo, seguindo só o README, publica e usa a War Room contra a sua API
  em até 15 minutos.
- **SC-006**: A automação declara só as três permissões do FR-004.

## Assumptions

- A branch principal é `main` (é a branch padrão do repositório).
- O mantenedor tem acesso de administrador ao repositório para ativar o Pages com a fonte
  "GitHub Actions" uma única vez; a spec não automatiza essa configuração.
- O repositório é público ou o plano permite Pages para ele.
- Não há outro site Pages neste repositório hoje (o único workflow existente é de testes de
  skills).
- A automação fica em `.github/workflows/` na raiz do repositório `cyzop/opspilot` e trabalha
  em `web/`.
- A API não é publicada por esta feature; cada operador aponta a engrenagem para a API que
  usa. Publicar a API fica fora de escopo.
- Não há domínio próprio; o endereço é o padrão do GitHub Pages.
- Pull requests não publicam; prévia por PR fica fora de escopo.
- O pedido nomeia as ações oficiais de upload do pacote e de publicação do Pages; a spec cita
  esses conceitos (pacote do site, permissões, ambiente) porque são o próprio escopo da feature.
