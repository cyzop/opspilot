# Research: OpsPilot HTTP Chat Registry

## Decision

The feature will expose a single HTTP endpoint that accepts a chat request, validates the payload with Zod, resolves the selected strategy via a central registry, and returns the result using the existing reasoning strategy contract.

## Rationale

- The project already has a mature strategy contract and reflection decorator; the HTTP layer should remain thin and delegated.
- Request validation should happen at the boundary before invoking domain logic to keep invalid requests from reaching the strategy layer.
- A central registry avoids scattered string comparisons and makes strategy selection and reflection configuration explicit and testable.
- Timeout handling is a boundary concern, so the HTTP service should enforce the 180-second budget without changing the strategy contract itself.

## Alternatives considered

1. Inline strategy resolution in the route handler
   - Rejected because it scatters strategy names across the HTTP layer and weakens testability.

2. Silent fallback on unknown strategy names
   - Rejected because the spec requires explicit `422` rejection and no silent substitution.

3. Timeout enforcement at the strategy layer
   - Rejected because the request lifecycle and HTTP status mapping belong at the boundary.

4. Reflection enabled by default
   - Rejected because the feature explicitly requires reflection to be opt-in and the default path to remain `react` without reflection.

## Resolved unknowns

- Default strategy: `react`
- Request fields: `message`, optional `strategy`, optional `reflect`
- Error mapping: `400` invalid body, `422` unknown strategy, `504` timeout exceeded
- Successful output shape: `{ answer, trace, metrics }`
- Reflection semantics: wrap the selected strategy only when `reflect` is enabled
