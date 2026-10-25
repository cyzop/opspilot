import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createOpsStore } from "../../src/store/ops-store.ts";
import { parseOpsDatabase, type OpsDatabase } from "../../src/store/ops-database.ts";
import { seedOpsDatabaseFile } from "../../src/../src/db/json-seed.ts";

function withTemporaryDatabase(run: (path: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "ops-pilot-json-seed-"));
  try {
    run(join(directory, "ops-store.json"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("seeds a JSON database idempotently while preserving operator-created records", () => {
  withTemporaryDatabase((path) => {
    const firstSeed = seedOpsDatabaseFile(path);
    assert.deepEqual(firstSeed, { services: 6, alerts: 6, incidents: 0 });

    const database = parseOpsDatabase(JSON.parse(readFileSync(path, "utf8")) as unknown);
    assert.equal(database.services.length, 6);
    assert.equal(database.alerts.length, 6);
    assert.equal(database.alerts.filter(({ status }) => status === "firing").length, 3);
    assert.equal(database.alerts.filter(({ status }) => status === "resolved").length, 3);
    const extended: OpsDatabase = {
      services: [
        ...database.services,
        { id: "billing", name: "Billing", description: "Billing service." },
      ],
      alerts: [
        ...database.alerts,
        {
          id: "alert-billing-error",
          serviceId: "billing",
          title: "Billing errors",
          severity: "low",
          status: "firing",
          createdAt: "2026-10-04T08:00:00.000Z",
        },
      ],
      incidents: [{
        id: "incident-001",
        title: "Existing billing incident",
        serviceId: "billing",
        severity: "low",
        status: "open",
        createdAt: "2026-10-04T08:10:00.000Z",
        resolvedAt: null,
        summary: null,
      }],
    };
    writeFileSync(path, `${JSON.stringify(extended, null, 2)}\n`);

    const secondSeed = seedOpsDatabaseFile(path);
    const thirdSeed = seedOpsDatabaseFile(path);
    const result = parseOpsDatabase(JSON.parse(readFileSync(path, "utf8")) as unknown);

    assert.deepEqual(secondSeed, { services: 6, alerts: 6, incidents: 1 });
    assert.deepEqual(thirdSeed, secondSeed);
    assert.equal(result.services.length, 7);
    assert.equal(result.alerts.length, 7);
    assert.equal(result.incidents.length, 1);
  });
});

test("loads JSON records into an isolated in-memory store for tool mutations", () => {
  withTemporaryDatabase((path) => {
    seedOpsDatabaseFile(path);
    const store = createOpsStore({ databasePath: path });
    const opened = store.openIncident({
      title: "Checkout recovering",
      service: "checkout",
      severity: "medium",
    });
    assert.equal(opened.id, "incident-001");
    assert.equal(store.listIncidents().length, 1);

    const diskData = parseOpsDatabase(JSON.parse(readFileSync(path, "utf8")) as unknown);
    assert.equal(diskData.incidents.length, 0);
    assert.equal(store.listAlerts().length, 3);
  });
});
