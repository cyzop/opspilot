# Chat HTTP Contract

## Endpoint

`POST /chat`

## Request body

```json
{
  "message": "Check the firing alerts for the auth service",
  "strategy": "react",
  "reflect": true
}
```

### Validation

- `message` is required and must be a non-empty string.
- `strategy` is optional and defaults to `react`.
- `reflect` is optional and must be a boolean when provided.
- Unknown strategy names are rejected with HTTP 422.

## Success response

**Status**: `200 OK`

```json
{
  "answer": "The auth service has two firing alerts ...",
  "trace": [
    { "type": "thought", "content": "I should inspect the current alerts." }
  ],
  "metrics": {
    "llmCalls": 2,
    "latencyMs": 1834
  }
}
```

## Error responses

### Bad request

**Status**: `400 Bad Request`

```json
{
  "error": "Invalid request body",
  "issues": [
    {
      "path": ["message"],
      "message": "Required"
    }
  ]
}
```

### Unsupported strategy

**Status**: `422 Unprocessable Entity`

```json
{
  "error": "Unknown strategy: custom-strategy"
}
```

### Timeout

**Status**: `504 Gateway Timeout`

```json
{
  "error": "Request timed out after 180s"
}
```
