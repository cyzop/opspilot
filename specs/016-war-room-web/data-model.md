# Data Model: War Room Web

## API

### SQLite table `approvals` (`src/approval/sqlite-approval-store.ts`)

```sql
CREATE TABLE IF NOT EXISTS approvals (
  id               TEXT PRIMARY KEY NOT NULL,              -- UUID
  request_id       TEXT NOT NULL,                          -- /chat request that paused
  conversation_id  TEXT NOT NULL,
  tool             TEXT NOT NULL CHECK (tool IN ('resolve_incident')),
  args             TEXT NOT NULL,                          -- JSON, validated by the tool schema
  target           TEXT NOT NULL,                          -- incident id
  description      TEXT NOT NULL,
  route            TEXT CHECK (route IN ('react','plan-and-execute','reflection')),
  model_used       TEXT,
  status           TEXT NOT NULL CHECK (status IN ('pending','approved','denied')),
  created_at       TEXT NOT NULL,                          -- ISO 8601
  expires_at       TEXT NOT NULL,                          -- created_at + 15 min
  decided_at       TEXT,
  decision_request_id TEXT                                 -- request that decided it
);
CREATE INDEX IF NOT EXISTS approvals_status ON approvals(status, expires_at);
```

`expired` is never stored: a `pending` row with `expires_at <= now` is reported as `expired`.

### `Approval` (Zod `approvalSchema`, strict)

| Field | Type | Rules |
|-------|------|-------|
| `id` | string | `z.uuid()` |
| `requestId` | string | `z.uuid()` |
| `conversationId` | string | non-empty |
| `tool` | `"resolve_incident"` | only gated tool |
| `args` | `{ id: string }` | `resolveIncidentInputSchema` |
| `target` | string | incident id (`args.id`) |
| `description` | string | e.g. `Resolver o incidente incident-001` |
| `status` | `pending` \| `approved` \| `denied` \| `expired` | `expired` derived |
| `createdAt`, `expiresAt` | ISO datetime | `expiresAt − createdAt = 15 min` |
| `decidedAt` | ISO datetime \| null | non-null iff approved/denied |

State transitions (one-way, first decision wins):

```text
pending ──approve──▶ approved
   │  └───deny────▶ denied
   └──(now ≥ expiresAt)──▶ expired (derived; decisions refused)
```

### `ApprovalStore`

```ts
interface ApprovalStore {
  create(input: NewApproval): Approval;                 // status pending, expiresAt = now + ttl
  get(id: string, now: Date): Approval | undefined;     // throws DomainValidationError on bad id
  claim(id: string, decision: "approved" | "denied", decisionRequestId: string, now: Date):
    { ok: true; approval: Approval } | { ok: false; reason: "unknown" | "not_pending" };
  close(): void;
}
```

### Errors (`src/approval/approval-errors.ts`)

| Class | Meaning | HTTP |
|-------|---------|------|
| `ApprovalRequiredError` | control flow: tool paused; carries `{ tool, args, description, trace }` | 202 (`/chat`) |
| `UnknownApprovalError` | id never issued | 404 |
| `ApprovalNotPendingError` | already decided or expired | 409 |

### Trace event `approval` (added to `traceEventSchema`)

```ts
{ type: "approval", node, content: string,
  approvalId: uuid, decision: "pending" | "approved" | "denied",
  tool: "resolve_incident", target: string }
```

### Request record changes (`src/store/request-store.ts`)

- `status` 202 allowed with `errorCategory: null` and metrics.
- Refine: `2xx ⇔ errorCategory === null` and `2xx ⇔ metrics !== null`.
- `/stats` counts 202 as a non-error.

### Approval policy (`src/approval/approval-context.ts`)

`runWithApprovalPolicy({ gated: ["resolve_incident"] }, fn)`; `approvalRequiredFor(tool)` →
boolean (false outside the policy, so CLI/MCP run tools directly).

### `OPSPILOT_CORS_ORIGINS`

Comma-separated exact origins; each must parse as an `http:`/`https:` URL whose `origin`
equals the trimmed value; `*` rejected. Default: `["http://localhost:5173"]`.

## Web (`web/src/lib`)

### `Settings`

| Field | Rules |
|-------|-------|
| `apiUrl` | absolute `http:`/`https:` URL, no username/password, no query/hash; trailing `/` removed; default `http://localhost:3000` |

Storage: `localStorage["opspilot.apiUrl"]`; theme override `localStorage["opspilot.theme"]` ∈
`light` \| `dark` \| absent (follow system).

### `Turn` (chat reducer state)

```ts
type Turn =
  | { id; message; status: "sending" }
  | { id; message; status: "answered"; answer; trace; metrics; requestId }
  | { id; message; status: "awaiting_approval"; approval; trace; metrics; requestId;
      decision: "idle" | "sending" | "approved" | "denied" | "not_pending";
      final?: { answer; trace } }
  | { id; message; status: "failed"; error: ApiError };

interface ChatState { conversationId: string | null; turns: Turn[]; notice: string | null }
```

Actions: `send`, `answered`, `awaitingApproval`, `failed`, `retry`, `decisionSent`,
`decided`, `decisionRefused`, `newConversation`, `apiChanged`. Rules: no `send` while a turn
is `sending` or a decision is `sending`; `apiChanged`/`newConversation` reset
`conversationId`; `failed` with category `unknown_conversation` resets it and sets `notice`.

### `ApiError`

`{ kind: "network" | "timeout" | "http" | "invalid_response"; status?: number; message: string;
requestId?: string }` — `message` is always a plain-language pt-BR sentence.

### `TraceItemView`

`{ key, kind, label, icon, node: string | null, content: string, details: Array<{ label;
value }> }` — produced by `toTraceItem(event)`; unknown kinds → `kind: "unknown"`, label
`Etapa`, `details` with the raw JSON.

### Design tokens (`web/src/styles/tokens.ts`)

- Space: `--space-1..8` = 4, 8, 12, 16, 24, 32, 48, 64 px.
- Type: `--font-1..6` = 12, 14, 16, 20, 24, 32 px; line-height 1.5.
- Colours (light and dark sets): `bg`, `surface`, `surface-raised`, `text`, `text-muted`,
  `border`, `primary`, `primary-text`, `danger`, `warning`, `success`, `focus`; plus one
  colour per trace kind. Contrast pairs tested (R7).
