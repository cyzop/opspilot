# Contract: `check_provider_status`

## Input

```ts
{
  provider?: "github" | "cloudflare"; // defaults to "github"
}
```

The provider field is described as the public dependency status page to inspect. Valid values map only to these fixed URLs:

| Provider | URL |
|---|---|
| `github` | `https://www.githubstatus.com/api/v2/status.json` |
| `cloudflare` | `https://www.cloudflarestatus.com/api/v2/status.json` |

## Upstream response

Required validated shape:

```json
{
  "status": {
    "indicator": "none",
    "description": "All Systems Operational"
  }
}
```

`indicator` and `description` must be non-empty strings. Other upstream fields are ignored. The status indicator is not locally mapped to a health result.

## Execution behavior

- Each fetch attempt has a 5-second timeout.
- A transport failure, including timeout, or HTTP 5xx is retried once, using a fresh timeout signal.
- No additional retries are made.
- Other non-2xx responses and malformed JSON/schema are terminal and are not retried.
- The fetch implementation is injectable for tests.
- Final errors are converted to a readable string result and never escape the tool boundary.

## Output

- Success is one compact line containing provider, indicator, and description.
- Final failure is one compact, readable error line identifying the provider and failure category.
- The tool never returns unvalidated provider data or converts an error into a healthy result.
