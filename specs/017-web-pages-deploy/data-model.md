# Data Model: Publicação da War Room no GitHub Pages

Não há dados persistidos. As "entidades" são configurações e artefatos de build.

## BuildBase (entrada de configuração)

| Campo | Origem | Regra |
|-------|--------|-------|
| `OPSPILOT_WEB_BASE` | variável de ambiente do build (opcional) | ausente ou vazia → `/opspilot/`; senão deve casar `^/([A-Za-z0-9._-]+/)*$` (começa e termina com `/`, segmentos sem espaço, `..`, `?`, `#`, `//`) |

- Valor resolvido = base do Vite (`base`), usada em todo `src`/`href` do `index.html`.
- Inválida → `Error("OPSPILOT_WEB_BASE inválida: … Use algo como /opspilot/.")`; o build falha.
- Exemplos: `/opspilot/` (local, padrão, e também o Pages de `cyzop/opspilot`).

## SitePackage (artefato `github-pages`)

```text
web/dist/
├── index.html        # src/href com prefixo OPSPILOT_WEB_BASE
└── assets/…          # js/css com hash
```

- Gerado no job `build`; tar criado pelo `upload-pages-artifact` (sem arquivos ocultos), retenção 1 dia.
- Única entrada do job `deploy`.

## Deployment (ambiente `github-pages`)

| Campo | Valor |
|-------|-------|
| `page_url` | saída do `deploy-pages` (raiz do site do repositório) |
| URL exibida | `page_url` (`https://cyzop.github.io/opspilot/`) |

Estados por execução: `queued → build (verifica) → [falha: nada publicado] | uploaded → deploying → active`.
Uma execução nova não cancela a em andamento (`cancel-in-progress: false`).
