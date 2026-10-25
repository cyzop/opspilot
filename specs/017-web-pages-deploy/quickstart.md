# Quickstart: validar a publicação no GitHub Pages

Repositório: [`cyzop/opspilot`](https://github.com/cyzop/opspilot) (a pasta `ops-pilot/`).
Site: `https://cyzop.github.io/opspilot/`.

## 1. Local (sem GitHub)

```bash
npm test --prefix web          # inclui build-config, base-path e pages-workflow
npm run build --prefix web     # base /opspilot/, a mesma do Pages deste repositório
grep -o 'src="[^"]*"\|href="[^"]*"' web/dist/index.html   # tudo começa com /opspilot/
```

Para testar outro prefixo: `OPSPILOT_WEB_BASE=/outro/ npm run build --prefix web`. No Git Bash do
Windows, rode `export MSYS_NO_PATHCONV=1` antes: sem isso, `/outro/` vira
`C:/Program Files/Git/outro/` e o build recusa a base ("OPSPILOT_WEB_BASE inválida").

Opcional, se tiver `actionlint`: `actionlint .github/workflows/opspilot-web-pages.yml`.

## 2. Ativar o Pages (uma vez, admin do repositório)

GitHub → `cyzop/opspilot` → **Settings → Pages → Build and deployment → Source: GitHub Actions**.

## 3. Primeira publicação

- Push da `main` para `origin` (aprovação manual), ou **Actions → "OpsPilot War Room — Pages" →
  Run workflow**.
- Esperado: `build` verde (typecheck, testes, build), `deploy` verde, link do ambiente
  `github-pages` = `https://cyzop.github.io/opspilot/`.

## 4. Site publicado

- Abrir `https://cyzop.github.io/opspilot/`.
- DevTools → Network: nenhum 404 para js/css.

## 5. Conversar com a API

```bash
# no .env da API (não versionado), editado pelo operador:
OPSPILOT_CORS_ORIGINS=http://localhost:5173,https://cyzop.github.io
npm run dev
```

Na War Room publicada: engrenagem → `http://localhost:3000` → **Testar conexão** → "Conectado"
(o Chrome pode pedir permissão de acesso à rede local). Enviar "Quais alertas?" → resposta.

## 6. Gatilhos e falhas

- Push na `main` mudando só fora de `web/` → nenhuma execução.
- Push com um teste quebrado em `web/` → `build` vermelho, `deploy` não roda, site anterior no ar.
- Dois `Run workflow` seguidos → o segundo espera o primeiro; o site termina com a última versão.
