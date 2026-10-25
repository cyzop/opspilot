# Quickstart: Validate the HTTP chat flow

## Prerequisites

- Node.js 22 LTS
- Project dependencies installed through `npm install`
- A valid local configuration for the existing runtime environment

## Validate with tests

```bash
npm test
npm run typecheck
```

## Manual validation scenarios

### 1. Valid request with default strategy

```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Check the current alert status"}'
```

Expected result:
- HTTP 200
- Body includes `answer`, `trace`, and `metrics`
- Strategy resolves to `react` by default

### 2. Valid request with explicit strategy and reflection

```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Check the alert detail","strategy":"plan-and-execute","reflect":true}'
```

Expected result:
- HTTP 200
- The selected strategy is resolved and reflected before execution

### 3. Invalid request body

```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"strategy":"react"}'
```

Expected result:
- HTTP 400
- Validation issues describe the missing `message`

### 4. Unsupported strategy

```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Test strategy","strategy":"unknown"}'
```

Expected result:
- HTTP 422
- Error clearly names the unsupported strategy

### 5. Timeout behavior

Invoke a strategy whose execution is intentionally delayed beyond 180 seconds in the test harness or a controlled stub. Expected result:
- HTTP 504
- Error message indicates the request timed out after the maximum budget
