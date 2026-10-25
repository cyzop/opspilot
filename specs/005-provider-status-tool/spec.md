# Feature Specification: External Provider Status Check

**Feature Branch**: `005-provider-status-tool`

**Created**: 2026-10-11

**Status**: Draft

**Input**: User description: "Tool de status de provedores externos: `check_provider_status` consulta a status page pública do GitHub ou Cloudflare sem chave. O parâmetro provider é enum `github|cloudflare`, default `github`, com descrição clara. A ferramenta deve orientar quando usar para distinguir problema interno de incidente do provedor ou dependência fora do ar. Deve usar timeout de 5s, uma nova tentativa em falha de rede ou HTTP 5xx, validar a resposta `{status: {indicator, description}}` com Zod, retornar uma linha compacta com indicador e descrição e converter qualquer falha final em string de erro legível como resultado da ferramenta, sem propagar exceção. Testes usam fetch injetável, sem rede, cobrindo sucesso, timeout e resposta inválida."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Check whether a dependency provider is experiencing an incident (Priority: P1)

As an on-call operator, I want to check the public status of GitHub or Cloudflare when an internal symptom may be caused by an external dependency so that I can quickly distinguish a local issue from a provider incident.

**Why this priority**: Knowing whether a critical dependency is impaired informs safe triage and prevents unnecessary internal changes.

**Independent Test**: Invoke the provider-status tool with a deterministic fake response for each supported provider and verify it returns a single concise line containing the validated indicator and description.

**Acceptance Scenarios**:

1. **Given** the operator suspects an external provider issue and omits the provider, **When** the status check runs, **Then** GitHub is checked and a compact status line is returned.
2. **Given** the operator suspects a Cloudflare dependency issue, **When** the operator selects `cloudflare`, **Then** Cloudflare status is checked and the returned line identifies its indicator and description.
3. **Given** the provider reports a non-healthy status, **When** the result is returned, **Then** the tool reports the provider's actual status without masking or converting it into a healthy state.

---

### User Story 2 - Receive a usable result when the status check fails (Priority: P2)

As an on-call operator, I want provider-status lookup failures to be bounded and reported as readable tool observations so that a network or provider problem does not interrupt the agent's operational response.

**Why this priority**: Status lookup is advisory; its failure must not prevent the operator from continuing internal investigation.

**Independent Test**: Inject fake fetch implementations for timeout, network/5xx failure, and malformed response cases; verify retry behavior where applicable and a readable result string without an exception escaping the tool.

**Acceptance Scenarios**:

1. **Given** a network failure, request timeout, or HTTP 5xx response, **When** the status check fails, **Then** it makes exactly one additional attempt before returning a readable failure result.
2. **Given** an individual provider request exceeds five seconds, **When** the timeout occurs, **Then** that attempt is aborted and handled as a failed lookup.
3. **Given** a successful HTTP response contains invalid or incomplete status data, **When** validation fails, **Then** the tool returns a readable error result rather than exposing unvalidated data or throwing.
4. **Given** the provider remains unavailable after the allowed attempt, **When** the tool completes, **Then** it returns one concise error line and the agent can continue its run.

### Edge Cases

- The provider argument is omitted, misspelled, or contains an unsupported value.
- The status endpoint times out, rejects at the network layer, or returns HTTP 5xx on both attempts.
- The endpoint returns a non-5xx HTTP error; it is reported as a failure without an unrequested retry.
- The endpoint returns malformed JSON or a body without non-empty `status.indicator` and `status.description`.
- A retry succeeds after the first attempt fails.
- The status description contains whitespace or line breaks; the tool output remains compact and single-line.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide a `check_provider_status` tool for checking the public status of GitHub and Cloudflare.
- **FR-002**: The tool MUST accept a `provider` value limited to `github` or `cloudflare`, MUST default to `github` when omitted, and MUST explain the parameter in its field description.
- **FR-003**: The tool MUST direct GitHub checks to `https://www.githubstatus.com/api/v2/status.json` and Cloudflare checks to `https://www.cloudflarestatus.com/api/v2/status.json` without requiring an API key.
- **FR-004**: The tool description MUST explain that it is appropriate when an operator suspects an external issue, needs to distinguish “ours or the provider's,” or is investigating an unavailable dependency.
- **FR-005**: Each provider request MUST have a five-second timeout.
- **FR-006**: On a network failure (including a request timeout) or HTTP 5xx response, the tool MUST make exactly one retry after the initial attempt; it MUST NOT retry more than once.
- **FR-007**: The system MUST validate a successful response against the required `{ status: { indicator, description } }` structure, where both `indicator` and `description` are non-empty strings, before using the status data.
- **FR-008**: A successful tool result MUST be compact, single-line text containing the status indicator and description.
- **FR-009**: Any final network, HTTP, timeout, JSON, or schema-validation failure MUST be returned as a readable string result by the tool and MUST NOT escape as an exception.
- **FR-010**: The provider fetch operation MUST be injectable so tests can cover success, timeout, retry, and invalid-response behavior without network access.
- **FR-011**: The tool MUST not present missing, invalid, or failed provider data as a healthy status.

### Key Entities

- **Provider selection**: The supported external provider (`github` or `cloudflare`) whose public status is requested.
- **Provider status**: The validated indicator and human-readable description published for the selected provider.
- **Status check result**: A compact success observation or readable failure observation returned to the agent.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Operators can request either supported provider's status and receive the selected provider's indicator and description in one line.
- **SC-002**: 100% of timed-out status attempts stop after five seconds and do not prevent the rest of the agent's work from continuing.
- **SC-003**: 100% of network and HTTP 5xx failures result in no more than two total attempts.
- **SC-004**: 100% of malformed or incomplete status responses are rejected and never represented as a provider status.
- **SC-005**: 100% of final status-check failures appear as readable tool results, with no exception escaping the tool boundary.
- **SC-006**: The success, timeout, retry, and invalid-response scenarios can be verified in deterministic tests without contacting either provider.

## Assumptions

- Public provider status endpoints are advisory and may not expose all provider incidents or represent the affected customer path.
- Only GitHub and Cloudflare are in scope for this version; additional providers require a separate supported value and endpoint decision.
- An attempt means one fetch operation with its own five-second timeout; the retry receives a fresh timeout budget.
- HTTP 5xx, network failures, and timeouts are retryable; other non-success HTTP responses are reported without retry.
- The tool reports provider status only and does not initiate a local remediation or alter incident records.
