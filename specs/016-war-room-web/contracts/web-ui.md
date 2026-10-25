# Contract: War Room UI

Design rules: `.claude/rules/design.md` (same as `.github/instructions/design.instructions.md`).
All visible copy in pt-BR.

## Layout (single page, `/opspilot/`)

```text
┌ header ─────────────────────────────────────────────┐
│ h1 "War Room"   [Nova conversa]   [◐ tema] [⚙]      │
├ main (role=main) ───────────────────────────────────┤
│ notice (role=status, optional)                       │
│ conversation (role=log, aria-live=polite)            │
│   Turn: operator bubble → agent answer / card / err  │
│        [▸ Ver raciocínio] → TraceList + Metrics      │
├ footer ─────────────────────────────────────────────┤
│ <label>Mensagem</label> textarea  [Enviar] (primary) │
└──────────────────────────────────────────────────────┘
```

One primary action per area: `Enviar` (composer), `Aprovar` (approval card), `Salvar`
(settings).

## States per turn

| State | Render |
|-------|--------|
| empty (no turns) | heading "Pronto para o plantão", one sentence, 3 clickable example questions |
| sending | skeleton lines in the agent slot (same height as a short answer); composer disabled |
| answered | answer text (`white-space: pre-wrap`), `Ver raciocínio` toggle (`aria-expanded`, `aria-controls`) |
| awaiting_approval | ApprovalCard (below) |
| failed | ErrorNotice: plain message, `Tentar de novo` button, "ID: <requestId>" when present; typed message kept |

## TraceList

- Ordered list (`<ol>`), one `<li>` per event in response order.
- Each item: icon (`aria-hidden`) + label text (kind) + node badge + content (`<pre>` with
  wrapping) + details (`<dl>`).
- Unknown kind → label "Etapa" and raw JSON.
- Empty trace → "Nenhuma etapa de raciocínio registrada."
- MetricsSummary (`<dl>`): Modelo, Chamadas ao modelo, Latência (ms), Tokens de prompt
  ("não disponível" when null).

## ApprovalCard

- `role="region"`, `aria-labelledby` its title "Aprovação necessária"; announced via the
  conversation live region; critical, so `aria-live="assertive"` only on the card title when it
  first appears.
- Body: description, "Ferramenta: resolve_incident", "Alvo: <target>", args (`<pre>`),
  "Expira às HH:MM".
- Buttons: `Aprovar` (primary), `Negar` (secondary, danger outline). Both `disabled` +
  `aria-busy` while sending.
- After decision: badge "Aprovado" / "Negado" / "Não está mais pendente" (text + icon),
  buttons removed, final answer and its trace rendered below.

## SettingsDialog

- Opened by gear `<button aria-label="Configurações">`; native `<dialog>` with `showModal()`
  (focus trap, `Esc` closes); focus returns to the gear.
- Field: `<label for>` "URL da API", `type="url"`, error text linked by `aria-describedby`.
- Buttons: `Testar conexão` (secondary), `Cancelar`, `Salvar` (primary).
- Test result in `role="status"`: "Conectado" or failure sentence.

## Theme

- Default follows `prefers-color-scheme`; toggle sets `data-theme` on `<html>` and persists
  `opspilot.theme`; `color-scheme` set accordingly.
- Reduced motion: no skeleton shimmer when `prefers-reduced-motion: reduce`.

## Accessibility acceptance

- `axe-core` on: empty state, answered turn with open trace, approval card, error, settings
  dialog → no `serious`/`critical` violations.
- Keyboard: Tab order header → conversation controls → composer; `Enter` sends,
  `Shift+Enter` new line; all actions reachable; `:focus-visible` ring uses `--color-focus`.
- Touch targets ≥ 44×44 px for buttons.
