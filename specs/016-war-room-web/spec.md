# Feature Specification: War Room Web

**Feature Branch**: `016-war-room-web`

**Created**: 2026-10-24

**Status**: Draft

**Input**: User description: "War rrom web/ (Vite+react+TS) com as instructions de design: chat -> /chat, com \"ver raciocínio\" abrindo o trace tipado. 202 vira cartão aprovar/negar; engrenagem com URL da API; base /opspilot/; CORS"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Talk to the agent from a browser war room (Priority: P1)

As an on-call operator, I want a web "war room" page where I type a question about alerts and incidents and read the agent's answer, keeping the conversation going across several turns, so that I can work an incident without using curl or the CLI.

**Why this priority**: Without a working chat there is no war room; every other story builds on this screen.

**Independent Test**: With the API running on fake or real models, open the war room, send two related messages and verify both answers appear in order and the second answer uses the context of the first (same conversation).

**Acceptance Scenarios**:

1. **Given** the war room is open and the API is reachable, **When** the operator sends a message, **Then** the message appears in the conversation at once, a loading indicator shows while the agent works, and the agent's answer replaces the indicator.
2. **Given** a first answer was received, **When** the operator sends a follow-up, **Then** it continues the same conversation, and the operator can start a new conversation explicitly.
3. **Given** no message has been sent yet, **When** the page opens, **Then** an empty state explains what the war room does and suggests example questions the operator can click.
4. **Given** the API returns an error or cannot be reached, **When** a message is sent, **Then** the conversation shows a plain-language error next to that message with a retry action and, when the API supplied one, the request identifier; the typed message is not lost.
5. **Given** a message is being processed, **When** the operator tries to send another, **Then** the send action is disabled until the current turn ends, and an empty or whitespace-only message cannot be sent.

---

### User Story 2 - "Ver raciocínio": inspect the typed reasoning trace (Priority: P1)

As an operator who must trust the agent's answer before acting, I want a "ver raciocínio" control under each answer that opens the trace of that turn, showing each step with its kind (route, thought, action, observation, plan, critique, summary, fallback, answer), the graph stage that produced it and its content, in the original order, so that I can see what the agent checked and why.

**Why this priority**: In an incident the operator needs to verify evidence; the trace is what makes the answer auditable. It only needs the chat response, so it ships with Story 1.

**Independent Test**: Send a message that makes the agent call a tool, open "ver raciocínio" on the answer and verify every trace event of the response is listed in order, each event kind has its own label and icon, and tool actions show the tool name and its arguments.

**Acceptance Scenarios**:

1. **Given** an answer is shown, **When** the operator activates "ver raciocínio", **Then** the trace opens showing every event of that turn in order, each with a readable kind label, its stage and its content; activating it again closes it.
2. **Given** a trace with a route decision, tool actions with observations, a critique and a fallback, **When** it is displayed, **Then** each kind is visually distinct by label and icon (not only by colour), tool actions show tool name and arguments, and route events show the chosen route and reason.
3. **Given** a trace contains an event kind the page does not recognise, **When** it is displayed, **Then** it is shown as a generic step with its raw content instead of breaking the page.
4. **Given** a turn with an empty trace, **When** the operator opens it, **Then** an empty state says no reasoning steps were recorded.
5. **Given** the trace is open, **When** the operator uses only the keyboard or a screen reader, **Then** the control announces whether it is expanded and the steps are read in order.
6. **Given** the turn's metrics are available, **When** the trace is open, **Then** a short summary shows model used, number of model calls, latency and prompt tokens.

---

### User Story 3 - Approve or deny resolving an incident (Priority: P2)

As an operator, I want the agent to stop and ask before it resolves an incident, shown in the war room as a card with what it wants to do and "Aprovar" / "Negar" buttons, so that no incident is closed without a human decision.

**Why this priority**: It protects production records, but the war room is already useful for read-only investigation without it.

**Independent Test**: Ask the agent to resolve a known incident; verify the response is a pending-approval result (not an answer), the war room shows a card with the action, target and arguments, and that approving executes the action and shows the final answer, while denying leaves the incident unchanged and shows that the action was not executed.

**Acceptance Scenarios**:

1. **Given** the agent decides to resolve an incident, **When** the turn reaches that action, **Then** the chat request ends with a "pending approval" result (HTTP 202) describing the proposed action, its target and its arguments, and the action has not run.
2. **Given** a pending-approval result, **When** the war room receives it, **Then** it shows an approval card with a clear title, the action in plain language, the target and the arguments, and two buttons: "Aprovar" (primary) and "Negar".
3. **Given** an approval card, **When** the operator approves, **Then** the action runs once, the card changes to "aprovado", and the agent's final answer for that turn appears with its trace.
4. **Given** an approval card, **When** the operator denies, **Then** the action does not run, the card changes to "negado", and the agent replies that the action was not executed.
5. **Given** a decision is being sent, **When** the operator clicks again, **Then** the buttons are disabled so the decision cannot be submitted twice.
6. **Given** a pending approval that was already decided, expired or no longer exists, **When** a decision is sent, **Then** the server refuses it without running anything and the card shows that the request is no longer pending.
7. **Given** the agent only reads data (lists alerts, checks providers, reads runbooks) or opens an incident, **When** it answers, **Then** no approval is requested.

**Clarified scope (2026-10-24)**: The approval pause is added to the API in this feature, and only for resolving an incident. Opening an incident keeps running without approval.

---

### User Story 4 - Settings gear with the API address (Priority: P2)

As an operator, I want a gear button that opens settings where I set the API address, check that it answers and keep it saved in this browser, so that the same war room works against my local API or a shared one.

**Why this priority**: Needed as soon as the page is not served next to the API, but a sensible default makes Stories 1–2 work without it.

**Independent Test**: Open settings, enter an invalid address and see a validation message; enter a valid reachable address, test it, save, reload the page and verify chat requests go to the saved address.

**Acceptance Scenarios**:

1. **Given** the war room, **When** the operator activates the gear (labelled for screen readers), **Then** a settings dialog opens showing the current API address.
2. **Given** the dialog, **When** the operator enters something that is not an http or https address, **Then** saving is blocked with a message next to the field.
3. **Given** a valid address, **When** the operator tests the connection, **Then** the dialog reports "connected" or a plain-language failure (unreachable, blocked by the browser's cross-origin rules, unexpected response).
4. **Given** the address was saved, **When** the page is reloaded, **Then** the saved address is used; if browser storage is unavailable, the default address is used and the page still works.
5. **Given** the dialog is open, **When** the operator presses Escape or cancels, **Then** it closes without changes and focus returns to the gear.
6. **Given** the address changes, **When** the next message is sent, **Then** it starts a new conversation on the new API (conversation identifiers are not reused across APIs).

---

### User Story 5 - Served under /opspilot/ and allowed by the API across origins (Priority: P3)

As whoever deploys OpsPilot, I want the war room to work when published under the `/opspilot/` path of a host, and the API to accept browser calls from the war room's origin, so that the page and the API can live on different hosts or ports.

**Why this priority**: Deployment concern; local development can work around it, but a shared war room needs it.

**Independent Test**: Build the war room for `/opspilot/`, serve it under that path from a different origin than the API, and verify the page, its assets and a chat turn all work; then call the API from an origin that is not allowed and verify the browser blocks it.

**Acceptance Scenarios**:

1. **Given** the war room published under `/opspilot/`, **When** it is opened at `/opspilot/` (with or without trailing slash) or reloaded, **Then** the page and all its assets load from under that path.
2. **Given** the war room on an allowed origin different from the API, **When** it sends chat, approval, stats or lookup requests, **Then** the API answers them, including the browser's preflight checks, and the page can read the `X-Request-Id` header.
3. **Given** a page on an origin that is not allowed, **When** it calls the API, **Then** the API does not grant cross-origin access.
4. **Given** no allowed origins are configured, **When** the API starts, **Then** only the local development origin of the war room is allowed (never every origin).

---

### Edge Cases

- The agent takes longer than the API timeout: the turn shows the timeout error with the request identifier and a retry action.
- The API answers with something that is not the expected shape: the war room shows a generic error rather than broken content, and does not render it as an answer.
- Very long answers, trace contents or tool arguments: they wrap or scroll inside their block, never widen the page; the layout works from 320px wide.
- Answer and trace text come from the model and tools: they are always shown as text, never interpreted as page markup.
- The browser goes offline mid-turn: the turn shows a connection error; the message can be retried.
- The conversation identifier kept for the session no longer exists on the API (e.g. a new database): the war room starts a new conversation and says so.
- An approval card is left open and the page is reloaded: the card is shown again as pending only if the API still reports it as pending; otherwise it is not resurrected.
- Two operators decide the same approval: the first decision wins; the second gets "no longer pending".
- The theme is switched while the page is open: the page follows without reload, and severity colours stay readable.

## Requirements *(mandatory)*

### Functional Requirements

**Chat**

- **FR-001**: The war room MUST send each operator message to the existing chat endpoint and show the answer in a conversation view, in order, distinguishing operator and agent messages.
- **FR-002**: The war room MUST keep the conversation identifier returned by the API and send it on later turns; it MUST offer a "nova conversa" action that starts a new one.
- **FR-003**: Each turn MUST have visible loading, success and error states; errors MUST be in plain language, include the request identifier when present and offer retry without losing the message.
- **FR-004**: The war room MUST validate every API response against the expected shape before showing it; unexpected shapes are treated as errors.
- **FR-005**: Model and tool text MUST be rendered as plain text, never as executable markup.

**Trace**

- **FR-006**: Each agent answer MUST have a "ver raciocínio" toggle (closed by default) that shows the turn's trace events in original order.
- **FR-007**: Each trace event MUST show its kind label, the stage (graph node) that produced it and its content; kinds MUST have a distinct label and icon: route (chosen route, reason, source), thought, action (tool name and arguments), observation, plan, critique, summarize, fallback, answer.
- **FR-008**: Unknown event kinds MUST be shown as a generic step without breaking the page; an empty trace MUST show an empty state.
- **FR-009**: The open trace MUST show a short metrics summary of the turn: model used, model calls, latency and prompt tokens (or "not available").

**Approval**

- **FR-010**: Before resolving an incident, the agent MUST pause the turn and the chat request MUST end with HTTP 202 and a pending-approval body: approval identifier, request identifier, conversation identifier, action name, target (incident identifier), arguments and a human-readable description. Read-only tools and opening an incident MUST NOT require approval.
- **FR-011**: The API MUST accept exactly one decision (approve or deny) per pending approval; approve runs the action once and continues the turn to a final answer; deny skips the action and the agent answers that it was not executed. Decisions on unknown, already decided or expired approvals MUST be refused without side effects.
- **FR-012**: Pending approvals MUST expire after 15 minutes without a decision.
- **FR-013**: The war room MUST show a 202 result as an approval card with the action, target, arguments and "Aprovar" (primary) / "Negar" buttons, disable both while a decision is in flight, and update the card to approved, denied or "no longer pending".
- **FR-014**: Approval decisions and their outcome MUST appear in the turn's trace and be recorded with the request, consistent with the existing request trace.

**Settings**

- **FR-015**: A gear button with an accessible name MUST open a settings dialog to view, edit, test and save the API address.
- **FR-016**: The API address MUST be an absolute http or https address; invalid values MUST be refused with a message next to the field.
- **FR-017**: The saved address MUST persist in the operator's browser; when nothing is saved or storage is unavailable, the war room MUST use a default address (the API's local development address).
- **FR-018**: "Testar conexão" MUST report success or a plain-language failure reason without sending a chat message.

**Hosting and cross-origin**

- **FR-019**: The war room MUST be publishable under the `/opspilot/` base path, with every asset and internal link resolved under it.
- **FR-020**: The API MUST allow cross-origin browser requests only from a configured list of origins, MUST answer preflight requests for the endpoints the war room uses, and MUST expose the `X-Request-Id` header to the page.
- **FR-021**: When no origins are configured, the API MUST allow only the war room's local development origin; it MUST never allow every origin.

**Design** (following the project's design instructions for `web/`)

- **FR-022**: The page MUST follow the design instructions in `.github/instructions/design.instructions.md` / `.claude/rules/design.md`: clear hierarchy with one primary action per area, spacing and type from the defined scales, empty/loading/error states for every data view, light and dark themes from semantic colour tokens (following the system preference with a manual override), and WCAG 2.2 AA accessibility (contrast, keyboard operation, visible focus, labelled controls, live announcements of new answers and approval requests, reduced motion).

### Key Entities

- **Chat turn**: one operator message and its outcome — an answer with trace and metrics, a pending approval, or an error; carries the request and conversation identifiers.
- **Trace event**: one typed reasoning step (kind, stage, content and kind-specific fields such as tool name and arguments, or chosen route).
- **Pending approval**: a paused incident resolution awaiting a decision — identifier, request, conversation, action, target, arguments, description, status (pending, approved, denied, expired) and expiry time.
- **War room settings**: the API address chosen by the operator, kept in their browser.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator who opens the war room for the first time can send a question and read the answer in under 1 minute without instructions.
- **SC-002**: For 100% of answers, the trace shown under "ver raciocínio" contains the same events, in the same order, as the API response.
- **SC-003**: 0 incidents are resolved without an explicit approval; a denied resolution leaves the incident unchanged in 100% of tests.
- **SC-004**: Every screen passes an automated accessibility check with no serious or critical violations in both light and dark themes, and every action can be completed with the keyboard alone.
- **SC-005**: Every API failure seen by the operator shows a plain-language message and a retry or next step; none shows raw technical output.
- **SC-006**: The same build works under `/opspilot/` from a different origin than the API, with no failed asset loads and no cross-origin errors for allowed origins.

## Assumptions

- The war room is a separate front-end project in `web/` (Vite + React + TypeScript, per the request), with its own build and tests; the API stays in the existing server.
- Single-team, trusted use: there is no login; anyone who can open the war room can chat and approve. Authentication is out of scope.
- The chat stays request/response (no streaming of partial answers); the loading state covers the wait.
- The default API address is the local development API (`http://localhost:3000`); the allowed-origins list is configured on the API by an environment variable.
- The trace kinds shown are the ones the API already produces; the war room tolerates new kinds (FR-008).
- Pending approvals do not need to survive an API restart; after a restart they are treated as expired.
- Only resolving an incident needs approval in this feature; opening an incident stays automatic. Other channels that run the same tool (CLI, MCP server) keep their current behaviour.
- The `/stats` and `/requests/:id` endpoints are not part of the war room screens in this feature, but cross-origin access covers them for later use.
