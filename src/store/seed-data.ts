import { alertSchema, runbookSchema, serviceSchema } from "../domain/domain.ts";

export const serviceFixtures = Object.freeze([
  { id: "payments", name: "Payments API", description: "Payment authorization and settlement API." },
  { id: "checkout", name: "Checkout", description: "Customer checkout and order creation." },
  { id: "database", name: "Primary Database", description: "Primary transactional database." },
  { id: "search", name: "Search", description: "Product search and discovery." },
  { id: "worker", name: "Background Workers", description: "Asynchronous job processing." },
  { id: "catalog", name: "Catalog", description: "Product catalog and inventory browsing." },
].map((service) => Object.freeze(serviceSchema.parse(service))));

export const alertFixtures = Object.freeze([
  {
    id: "alert-api-latency",
    serviceId: "payments",
    title: "Payment API p95 latency above 2 seconds",
    severity: "critical",
    status: "firing",
    createdAt: "2026-10-01T08:00:00.000Z",
  },
  {
    id: "alert-checkout-errors",
    serviceId: "checkout",
    title: "Checkout error rate above 5 percent",
    severity: "high",
    status: "firing",
    createdAt: "2026-10-01T08:05:00.000Z",
  },
  {
    id: "alert-database-cpu",
    serviceId: "database",
    title: "Primary database CPU saturation",
    severity: "critical",
    status: "resolved",
    createdAt: "2026-10-01T07:00:00.000Z",
  },
  {
    id: "alert-payment-timeout",
    serviceId: "payments",
    title: "Upstream payment provider timeouts",
    severity: "high",
    status: "resolved",
    createdAt: "2026-10-01T07:15:00.000Z",
  },
  {
    id: "alert-search-availability",
    serviceId: "search",
    title: "Search availability below service objective",
    severity: "medium",
    status: "firing",
    createdAt: "2026-10-01T08:10:00.000Z",
  },
  {
    id: "alert-worker-queue",
    serviceId: "worker",
    title: "Background job queue depth elevated",
    severity: "medium",
    status: "resolved",
    createdAt: "2026-10-01T06:45:00.000Z",
  },
].map((alert) => Object.freeze(alertSchema.parse(alert))));

export const runbookFixtures = Object.freeze([
  {
    service: "checkout",
    name: "Checkout incident response",
    summary: "Restore checkout availability and confirm that new orders can be created.",
    steps: [
      "Check the checkout error-rate alert and recent deployment changes.",
      "Verify checkout dependencies, especially payments and the primary database.",
      "Roll back the latest change only when the error increase correlates with that change.",
      "Confirm a test order succeeds before resolving the incident.",
    ],
  },
  {
    service: "payments",
    name: "Payments incident response",
    summary: "Restore payment authorization while avoiding duplicate charges.",
    steps: [
      "Check payment API latency and upstream provider timeout alerts.",
      "Verify provider health and authorization error rates before retrying requests.",
      "Do not replay a payment unless its idempotency status is confirmed.",
      "Confirm authorization and settlement health before resolving the incident.",
    ],
  },
  {
    service: "auth",
    name: "Authentication incident response",
    summary: "Restore sign-in and token validation without weakening access controls.",
    steps: [
      "Check authentication error rates and identity-provider availability.",
      "Verify token signing and validation dependencies without exposing credentials.",
      "Do not disable authentication checks as a workaround.",
      "Confirm sign-in and token validation succeed before resolving the incident.",
    ],
  },
].map((runbook) => Object.freeze(runbookSchema.parse(runbook))));
