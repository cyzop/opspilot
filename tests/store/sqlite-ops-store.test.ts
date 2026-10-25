import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SqliteOpsStore } from "../../src/store/sqlite-ops-store.ts";

test("seeds an isolated in-memory database with the Mercadinho scenario", (context) => {
  const store = new SqliteOpsStore(":memory:");
  context.after(() => store.close());

  assert.equal(store.listServices().length, 5);
  assert.equal(store.listAlerts("all").length, 6);
  assert.equal(store.listAlerts("firing").length, 3);
  assert.equal(store.listAlerts("resolved").length, 3);
  assert.equal(store.getRunbook("checkout").service, "checkout");
  assert.equal(store.getRunbook("payments").service, "payments");
  assert.equal(store.getRunbook("auth").service, "auth");
});

test("reapplies the default seed idempotently when a database is reopened", () => {
  const directory = mkdtempSync(join(tmpdir(), "opspilot-sqlite-"));
  const path = join(directory, "opspilot.db");

  try {
    const first = new SqliteOpsStore(path);
    assert.equal(first.listServices().length, 5);
    first.close();

    const reopened = new SqliteOpsStore(path);
    try {
      assert.equal(reopened.listServices().length, 5);
      assert.equal(reopened.listAlerts("all").length, 6);
      assert.equal(reopened.listIncidents("all").length, 0);
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("opens, filters, and resolves incidents while preserving resolution metadata", (context) => {
  const store = new SqliteOpsStore(":memory:", {
    now: () => new Date("2026-10-09T12:00:00.000Z"),
  });
  context.after(() => store.close());

  const opened = store.openIncident({
    title: "Checkout failing",
    service: "checkout",
    severity: "high",
  });
  assert.equal(opened.status, "open");
  assert.equal(opened.resolvedAt, null);
  assert.equal(opened.summary, null);
  assert.deepEqual(store.listIncidents("open").map(({ id }) => id), [opened.id]);
  assert.deepEqual(store.listIncidents("resolved"), []);

  const resolved = store.resolveIncident(opened.id);
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.resolvedAt, "2026-10-09T12:00:00.000Z");
  assert.equal(resolved.summary, "Checkout failing");
  assert.deepEqual(store.listIncidents("open"), []);
  assert.deepEqual(store.listIncidents("resolved"), [resolved]);
  assert.deepEqual(store.listIncidents("all"), [resolved]);
  assert.deepEqual(store.resolveIncident(opened.id), resolved);
});

test("database CHECK constraints reject invalid severity and status values", (context) => {
  const store = new SqliteOpsStore(":memory:");
  context.after(() => store.close());

  assert.throws(() => store._db.prepare(`
    INSERT INTO alerts (id, service_id, title, severity, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    "invalid-severity",
    "checkout",
    "Bad severity",
    "sev1",
    "firing",
    "2026-10-09T12:00:00.000Z",
  ), /CHECK constraint failed/);

  assert.throws(() => store._db.prepare(`
    INSERT INTO incidentes
      (id, title, service_id, severity, status, created_at, resolved_at, summary)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "invalid-status",
    "Bad status",
    "checkout",
    "high",
    "mitigated",
    "2026-10-09T12:00:00.000Z",
    null,
    null,
  ), /CHECK constraint failed/);
});

test("rejects unknown services and runbooks with explicit domain errors", (context) => {
  const store = new SqliteOpsStore(":memory:");
  context.after(() => store.close());

  assert.throws(
    () => store.openIncident({ title: "Unknown", service: "missing", severity: "low" }),
    /Unknown service/,
  );
  assert.throws(() => store.getRunbook("missing"), /Unknown runbook/);
});
