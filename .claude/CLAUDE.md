# OpsPilot

OpsPilot é um copiloto de plantão para gerenciar alertas de incidentes de produção. A APO é um agente LangChain/LangGraph que usa OpenRouter.

## Stack

- Node.js 22 LTS; TypeScript ESM com `strict: true`.
- LangChain/LangGraph e OpenRouter para a APO.
- Zod valida entradas e saídas nas fronteiras HTTP e CLI.
- Express, Sequelize e MySQL (`mysql2`).
- Testes com `node:test` via `tsx`.

## Comandos

Consulte `package.json` como fonte de verdade:

- `npm run dev`
- `npm run arena`
- `npm run bench`
- `npm test`
- `npm run typecheck`

## Convenções

- Organize o código nas camadas MVC: Model, Service e Controller.
- Valide toda entrada externa e toda saída de fronteira com Zod.
- Represente erros de domínio com classes e traduza-os na borda.
- Crie testes junto com a lógica nova; mantenha `npm run typecheck` e `npm test` verdes.
- Escreva a lógica como funções puras e isole I/O e efeitos externos nas bordas.
- Nunca inclua secrets no Git. Não leia manualmente nem imprima o conteúdo de `.env` no terminal; os scripts podem carregá-lo automaticamente pelo recurso nativo do Node.

## Fluxo de especificação

- Siga este fluxo do Spec Kit: `/speckit.specify` → `/speckit.plan` → `/speckit.tasks` → `/speckit.implement`.
- Versione as especificações no Git junto com o projeto.

## Segurança do agente

- Use `.vscode/settings.json` para as regras de aprovação de comandos.
- Regras `false` do VS Code pedem aprovação manual; não bloqueiam o comando. Revise qualquer pedido de aprovação e nunca aprove leitura de `.env`.
- `git push` não é autoaprovado e sempre exige aprovação manual.
