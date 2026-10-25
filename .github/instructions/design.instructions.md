---
applyTo: "web/**"
---

# Design da interface web

Regras para todo código em `web/`. O OpsPilot é usado em plantão, muitas vezes de madrugada e
sob pressão: a tela precisa mostrar primeiro o que exige ação.

## Hierarquia

- Um único título principal (`h1`) por página; níveis de heading em ordem, sem pular (`h2` → `h4`).
- A informação mais urgente vem primeiro e é a mais visível: severidade e status do alerta antes
  de metadados como id, horário e origem.
- No máximo uma ação primária por tela ou card. Ações secundárias usam estilo mais discreto;
  ações destrutivas usam a cor de perigo e pedem confirmação.
- Diferencie por tamanho, peso e espaço antes de recorrer a cor. Use no máximo 3 ou 4 tamanhos de
  fonte por tela, vindos da escala tipográfica.
- Agrupe itens relacionados e separe grupos com espaço, não com bordas extras.

## Espaçamento em escala

- Use só a escala de 4px: `4, 8, 12, 16, 24, 32, 48, 64`. Nenhum valor solto como `13px` ou `22px`.
- Exponha a escala como tokens (`--space-1` … `--space-8`) e use sempre os tokens.
- Espaço dentro de um grupo é menor que o espaço entre grupos.
- Tipografia também em escala (ex. `12, 14, 16, 20, 24, 32`) e altura de linha 1.4–1.6 em texto corrido.
- O layout funciona a partir de 320px de largura, sem rolagem horizontal da página.

## Estados vazios, de carregamento e de erro

Todo componente que mostra dados trata os quatro estados: carregando, vazio, erro e com dados.

- **Carregando:** skeleton ou indicador no lugar do conteúdo, mantendo o tamanho do layout para não
  pular. Não bloqueie a tela inteira por uma parte dela.
- **Vazio:** diga o que aconteceu e o próximo passo ("Nenhum alerta nas últimas 24h" + ação para
  mudar o período). Diferencie "não há dados" de "o filtro não encontrou nada" (este oferece limpar
  o filtro).
- **Erro:** mensagem em linguagem simples, sem stack trace nem texto bruto da API; diga o que o
  usuário pode fazer (tentar de novo, checar a conexão) e ofereça a ação. Mostre o `requestId`
  quando existir, para o plantonista correlacionar com os logs.
- Erros de formulário aparecem junto ao campo, ligados por `aria-describedby`, e não só num toast.
- Erros parciais não derrubam a página: o resto continua utilizável.

## Dark mode

- Todas as cores vêm de tokens semânticos (`--color-bg`, `--color-surface`, `--color-text`,
  `--color-text-muted`, `--color-border`, `--color-primary`, `--color-danger`, `--color-warning`,
  `--color-success`). Nenhuma cor literal em componentes.
- Respeite `prefers-color-scheme` por padrão e permita escolha manual (`data-theme="light|dark"`),
  que tem precedência sobre o sistema.
- No escuro, use cinzas escuros (não `#000` puro) e texto levemente fora do branco; superfícies
  mais elevadas ficam mais claras em vez de usar sombra.
- Reajuste as cores de severidade para o fundo escuro mantendo o contraste mínimo.
- Defina `color-scheme` para que controles nativos e barras de rolagem acompanhem o tema.
- Teste toda tela nova nos dois temas.

## Acessibilidade

- Meta WCAG 2.2 AA: contraste de 4.5:1 para texto normal e 3:1 para texto grande, ícones e bordas
  de controles, nos dois temas.
- Severidade e status nunca só por cor: acompanhe com texto ou ícone com rótulo.
- Use HTML semântico (`button`, `a`, `nav`, `main`, `table`, `label`) antes de ARIA; `div` clicável
  não é botão.
- Tudo funciona pelo teclado, em ordem lógica, com foco sempre visível (`:focus-visible`) e sem
  armadilhas de foco. Diálogos prendem e devolvem o foco e fecham com `Esc`.
- Todo campo tem `label`; ícones sem texto têm `aria-label`; imagens têm `alt` (vazio se decorativas).
- Conteúdo que muda sozinho (novos alertas, resultado de ação) é anunciado com `aria-live="polite"`;
  use `assertive` só para alertas críticos.
- Área de toque mínima de 24×24px (preferencialmente 44×44px).
- Respeite `prefers-reduced-motion`: sem animação não essencial.
- Valide com axe ou Lighthouse e navegue a tela pelo teclado antes de concluir.
