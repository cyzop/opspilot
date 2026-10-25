import assert from "node:assert/strict";
import test from "node:test";
import { UnknownIncidentError, UnknownServiceError } from "../../src/domain/errors.ts";
import { alertFixtures, serviceFixtures } from "../../src/../src/store/seed-data.ts";
import { createOpsStore } from "../../src/../src/store/ops-store.ts";

test("creates isolated stores with six services and six varied alerts", () => {
  const first = createOpsStore();
  const second = createOpsStore();

  assert.equal(serviceFixtures.length, 6);
  assert.equal(alertFixtures.length, 6);
  assert.equal(first.listServices().length, 6);
  assert.equal(first.listAlerts("all").length, 6);
  assert.equal(first.listAlerts("firing").length, 3);
  assert.equal(first.listAlerts("resolved").length, 3);
  assert.deepEqual(first.listAlerts("all").map(({ id }) => id), [
    "alert-api-latency",
    "alert-checkout-errors",
    "alert-database-cpu",
    "alert-payment-timeout",
    "alert-search-availability",
    "alert-worker-queue",
  ]);

  first.openIncident({
    title: "New incident",
    service: "payments",
    severity: "high",
  });
  assert.equal(first.listIncidents().length, 1);
  assert.equal(second.listIncidents().length, 0);
});

test("filters by alert status and returns all alerts for all", () => {
  const store = createOpsStore();

  assert.ok(store.listAlerts("firing").every(({ status }) => status === "firing"));
  assert.ok(store.listAlerts("resolved").every(({ status }) => status === "resolved"));
  assert.equal(store.listAlerts("all").length, 6);
});

test("opens incidents for known services and resolves them idempotently", () => {
  const store = createOpsStore({ now: () => new Date("2026-01-01T00:00:00.000Z") });
  const incident = store.openIncident({
    title: "Checkout errors",
    service: "checkout",
    severity: "critical",
  });
  assert.equal(incident.status, "open");
  assert.equal(incident.resolvedAt, null);
  assert.equal(incident.createdAt, "2026-01-01T00:00:00.000Z");

  const resolved = store.resolveIncident(incident.id);
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.resolvedAt, "2026-01-01T00:00:00.000Z");
  assert.deepEqual(store.resolveIncident(incident.id), resolved);
});

test("reports unknown service and incident identifiers as domain errors", () => {
  const store = createOpsStore();

  assert.throws(
    () => store.openIncident({ title: "Invalid", service: "missing", severity: "low" }),
    UnknownServiceError,
  );
  assert.throws(() => store.resolveIncident("missing"), UnknownIncidentError);
});
