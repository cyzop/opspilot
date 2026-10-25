import assert from "node:assert/strict";
import test from "node:test";
import { createOpsTools } from "../../src/../src/tools/index.ts";
import { SqliteOpsStore } from "../../src/store/sqlite-ops-store.ts";

test("exposes the Zod-backed tools", (context) => {
  const store = new SqliteOpsStore(":memory:");
  context.after(() => store.close());
  const tools = createOpsTools(store);
  assert.deepEqual(Object.values(tools).map(({ name }) => name), [
    "list_alerts",
    "list_incidentes",
    "consultar_runbook",
    "open_incidente",
    "resolve_incident",
    "check_provider_status",
  ]);
  assert.ok(Object.values(tools).some(({ name }) => name === "check_provider_status"));
});

test("shares one SQLite store between tools so an opened incident can be resolved", async (context) => {
  const store = new SqliteOpsStore(":memory:");
  context.after(() => store.close());
  const tools = createOpsTools(store);
  const opened = JSON.parse(await tools.openIncident.invoke({
    title: "Checkout failing",
    service: "checkout",
    severity: "high",
  }) as string) as { id: string };

  const resolved = JSON.parse(await tools.resolveIncident.invoke({ id: opened.id }) as string) as {
    status: string;
  };
  assert.equal(resolved.status, "resolved");
});
