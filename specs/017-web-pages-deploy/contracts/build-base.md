# Contract: base do build (`web/build-config.ts`)

```ts
export const DEFAULT_BASE = "/opspilot/";
export function resolveBase(raw: string | undefined): string;
```

| Entrada | Saída |
|---------|-------|
| `undefined`, `""`, `"  "` | `/opspilot/` |
| `/opspilot/` | `/opspilot/` |
| `/engenharia-de-software-com-ia-aplicada/opspilot/` (qualquer prefixo válido) | igual |
| ` /x/ ` (espaços em volta) | `/x/` |
| `opspilot/`, `/opspilot`, `https://x/`, `/a//b/`, `/a/../b/`, `/a b/`, `/a?x/`, `/a#x/` | lança `Error` com "OPSPILOT_WEB_BASE inválida" |

- `vite.config.ts`: `base: resolveBase(process.env.OPSPILOT_WEB_BASE)`. `dev`/`preview` locais
  seguem em `/opspilot/` quando a variável não está definida.
- No Pages o workflow passa `/<repositório>/` (`/opspilot/` em `cyzop/opspilot`).
- Build com `OPSPILOT_WEB_BASE=/repo/opspilot/` → todo `<script src>`/`<link href>` do
  `index.html` começa com `/repo/opspilot/` e aponta para arquivo existente em `dist/`.
