# Research: External Provider Status Check

## Decision: use the public Statuspage v2 status endpoints without authentication

The tool will use the fixed GitHub and Cloudflare `status.json` URLs specified in the feature. The endpoints return a top-level `status` object containing `indicator` and `description` fields and are publicly readable without an API key.

### Evidence

- GitHub endpoint: <https://www.githubstatus.com/api/v2/status.json>
- Cloudflare endpoint: <https://www.cloudflarestatus.com/api/v2/status.json>
- Atlassian Statuspage API reference: <https://developer.statuspage.io/>

The live endpoint responses inspected during planning included `{"status":{"indicator":"none","description":"All Systems Operational"}}` for GitHub and `{"status":{"indicator":"major","description":"Partial System Outage"}}` for Cloudflare. The value difference reinforces that the tool must report the source status as-is and not translate every response to “healthy”.

### Rationale

- The fixed URLs are public status endpoints and require no credentials.
- The documented response shape provides exactly the compact fields needed by the agent.
- Keeping endpoints in a closed provider map avoids constructing URLs from model-controlled input.

### Alternatives considered

- Require provider API keys: rejected because public status endpoints need no key and the feature explicitly excludes credentials.
- Accept arbitrary status URLs: rejected because this would let model-generated input control outbound destinations and exceed the two-provider scope.

## Decision: validate only the stable response contract and treat status text as data

Validate that the response is an object with a `status` object and non-empty string `indicator` and `description` fields. Do not hardcode a finite list of indicator values; status providers may add or change indicators, and the tool should report the published value without falsely converting it.

### Rationale

- The response envelope and its two user-facing fields are the required contract.
- A finite indicator enum would be unnecessarily brittle for an advisory integration.
- Strict shape validation ensures malformed upstream data never becomes a success observation.

### Alternatives considered

- Accept any JSON body and interpolate fields: rejected because external data is untrusted.
- Restrict indicator to a local enum: rejected because provider evolution could turn valid upstream state into a misleading error.

## Decision: bound every fetch attempt and retry one transient failure

Each fetch receives its own five-second abort timeout. A transport failure (including an abort timeout) or HTTP 5xx allows one and only one fresh attempt. Other non-success HTTP responses and JSON/schema failures are terminal and return a readable tool result without retry.

Node documents `AbortSignal.timeout(delay)` as returning a new signal that aborts after the requested delay. A new signal is therefore created per attempt, including any retry.

### Rationale

- A per-attempt timeout makes the latency bound explicit; at most two transient attempts give a maximum fetch budget of ten seconds, excluding small local parsing/formatting overhead.
- A fresh timeout signal is required for a retry because an aborted signal cannot be reused.
- The feature identifies network and 5xx errors as retryable and requires exactly one retry; malformed response data should not be repeatedly fetched as though it were transient transport failure.
- All final failures are surfaced as text observations at the tool boundary so the agent can continue.

### Alternatives considered

- Retry every HTTP error and schema failure: rejected because client errors and malformed data are not necessarily transient and repeated requests add latency.
- Use a single five-second timeout for the entire operation: rejected because the requirement specifies a five-second request timeout and one retry, so each attempt receives its own budget.
- Throw final errors from the tool: rejected because provider status is advisory and must not abort agent execution.

## Decision: put the integration in the existing tools package with an injected fetch dependency

The repository defines agent-callable operations in `src/tools/`, registers them through `createOpsTools` in `src/tools/index.ts`, and exposes them to both reasoning strategies through that factory. Implement the provider status tool alongside those tools and export a factory accepting a fetch-compatible function for deterministic tests.

### Rationale

- The requested `src/agents/tools.ts` path is not present in this repository; `src/tools/` and its shared factory are the established integration point.
- Injecting fetch isolates network I/O at the boundary and makes success, retry, timeout, HTTP, and validation cases testable without live requests.
- Returning a one-line result avoids sending the full upstream JSON into the model context.

### Alternatives considered

- Add `src/agents/tools.ts`: rejected because it would duplicate and bypass the existing tool registry.
- Test against the public provider endpoints: rejected because it would make the test suite network-dependent and nondeterministic.

## Sources

- <https://www.githubstatus.com/api/v2/status.json>
- <https://www.cloudflarestatus.com/api/v2/status.json>
- <https://developer.statuspage.io/#public-api>
- <https://nodejs.org/api/globals.html#static-method-abortsignaltimeoutdelay>
