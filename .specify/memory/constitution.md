<!--
Sync Impact Report
Version change: template → 1.0.0 (initial OpsPilot constitution)
Modified principles:
- Camadas explícitas → I. Arquitetura MVC e efeitos controlados
- Validações na fronteira → II. Contratos validados com Zod
- Erros de domínio → III. Erros explícitos
- Teste é parte da tarefa → IV. Testes e qualidade contínua
- Segurança por padrão, spec antes de código e pequeno/reversível
  → V. Segurança e mudanças guiadas por especificação
Added sections: Stack e comandos obrigatórios; Fluxo e gates de qualidade
Removed sections: none
Follow-up TODO: Confirmar a data original de ratificação.
-->
# OpsPilot Constitution

Princípios não negociáveis para especificações, planos, tarefas e código.

## Core Principles

### I. Arquitetura MVC e efeitos controlados
Organize a aplicação nas camadas Model, Service e Controller. A lógica de domínio
deve usar funções puras; mantenha I/O e efeitos externos nas bordas. Isso separa
as regras do produto dos detalhes de HTTP, CLI, banco de dados e provedores.

### II. Contratos validados com Zod
Valide com Zod toda entrada e saída nas fronteiras externas, incluindo HTTP e CLI.
Dados de provedores externos também são dados não confiáveis. Só passe valores
validados para as regras de domínio.

### III. Erros explícitos
Represente falhas previsíveis do domínio com classes de erro próprias e traduza-as
na borda para respostas HTTP ou resultados de CLI apropriados. Não esconda falhas
nem retorne resultados de sucesso como fallback para erros.

### IV. Testes e qualidade contínua
Toda lógica nova deve nascer com testes usando `node:test` via `tsx`. Mantenha
`npm test` e `npm run typecheck` verdes antes de concluir uma mudança.

### V. Segurança e mudanças guiadas por especificação
Nunca versione secrets nem leia manualmente ou imprima o conteúdo de `.env`.
Mudanças relevantes seguem o fluxo Spec Kit definido nesta constituição, com
revisão entre as fases. Mantenha tarefas pequenas, reversíveis e passíveis de
revisão isolada.

## Stack e comandos obrigatórios

- Use Node.js 22 LTS, TypeScript ESM e `strict: true`.
- Use Zod para validação, LangChain/LangGraph para a APO, OpenRouter como provedor
  do modelo, Express para HTTP e SQLite nativo via `node:sqlite` para persistência
  local.
- Use a variável de ambiente `OPSPILOT_DB` para o caminho do banco; o padrão é
  `./data/opspilot.db`, e os testes devem executar em `:memory:` para isolamento.
- Carregue variáveis locais pelos scripts com a opção nativa do Node
  `--env-file-if-exists=.env`; não adicione `dotenv`.
- Use `package.json` como fonte de verdade para scripts: `npm run dev`,
  `npm run arena`, `npm run bench`, `npm test` e `npm run typecheck`.

## Fluxo e gates de qualidade

- Para mudanças relevantes, siga `/speckit.specify` → `/speckit.plan` →
  `/speckit.tasks` → `/speckit.implement`.
- Versione as especificações no Git e revise os artefatos de cada fase antes de
  avançar para a seguinte.
- Verifique a conformidade com esta constituição nas revisões de especificações,
  planos, tarefas e implementação. Uma mudança não está pronta enquanto os testes
  e o typecheck falharem.

## Governance

Esta constituição prevalece sobre práticas locais incompatíveis. Para alterá-la,
proponha a emenda, atualize este documento e seu relatório de impacto, incremente
a versão conforme a política semântica e registre a alteração no Git. Use MAJOR
para mudanças incompatíveis em princípios, MINOR para novos princípios ou
orientações materiais e PATCH para esclarecimentos sem mudança de significado.
Revisores devem verificar a conformidade com os princípios e os gates de
qualidade; exceções precisam ser justificadas na especificação correspondente.

**Version**: 1.0.0 | **Ratified**: TODO(RATIFICATION_DATE): confirmar data original | **Last Amended**: 2026-10-03
