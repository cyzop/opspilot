import assert from "node:assert/strict";
import test from "node:test";
import { OpsService } from "../../src/domain/ops-service.ts";
import { SqliteOpsStore } from "../../src/store/sqlite-ops-store.ts";
import { createOpenIncidentTool } from "../../src/../src/tools/open-incident.ts";

test("opens an incident, returning the serialized validated record", async (context) => {
  const store = new SqliteOpsStore(":memory:");
  context.after(() => store.close());
  const openIncident = createOpenIncidentTool(new OpsService(store));
  assert.equal(openIncident.name, "open_incidente");

  const opened = JSON.parse(await openIncident.invoke({
    title: "Checkout failing",
    service: "checkout",
    severity: "high",
  }) as string) as { id: string; status: string };
  assert.equal(opened.status, "open");
});

test("propagates the unknown service domain error", async (context) => {
  const store = new SqliteOpsStore(":memory:");
  context.after(() => store.close());
  const openIncident = createOpenIncidentTool(new OpsService(store));
  await assert.rejects(openIncident.invoke({
    title: "Invalid service",
    service: "missing",
    severity: "low",
  }), /Unknown service/);
});
