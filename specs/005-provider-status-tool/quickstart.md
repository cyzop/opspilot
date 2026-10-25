# Quickstart: Provider status tool validation

## Prerequisites

- Node.js 22 LTS
- Project dependencies installed

## Run the offline test suite

```powershell
npm test
npm run typecheck
```

The provider-status tests must use an injected fake fetch and must not contact GitHub or Cloudflare.

## Validation scenarios

1. A fake successful GitHub response returns a compact one-line status with the default provider.
2. A fake successful Cloudflare response confirms the explicit provider-to-endpoint mapping.
3. A transient fetch rejection or HTTP 5xx followed by success succeeds on the second attempt and makes exactly two calls.
4. Two consecutive network failures, HTTP 5xx responses, or timeouts return one readable failure result and do not throw from the tool.
5. A non-5xx HTTP error and a malformed JSON/schema response return readable errors without retrying.
6. Each attempt receives an abort signal configured for a five-second timeout.

## Integration validation

Use `createOpsTools` to confirm `check_provider_status` is registered alongside the operations tools and is available through both reasoning strategies. Tool descriptions should make clear that this is an advisory check for suspected external dependency incidents.
