import assert from "node:assert/strict";
import test from "node:test";
import { OpsService } from "../../src/domain/ops-service.ts";
import { SqliteOpsStore } from "../../src/store/sqlite-ops-store.ts";
import { createListIncidentesTool } from "../../src/tools/list-incidentes.ts";

test("lists open incidents by default and supports resolved/all filters", async (context) => {
  const store = new SqliteOpsStore(":memory:");
  context.after(() => store.close());
  const service = new OpsService(store);
  const listIncidentes = createListIncidentesTool(service);
  const incident = service.openIncident({
    title: "Payment delay",
    service: "payments",
    severity: "critical",
  });

  assert.equal(listIncidentes.name, "list_incidentes");
  assert.match(listIncidentes.description, /status aceita open \| resolved \| all/i);
  assert.equal(JSON.parse(await listIncidentes.invoke({}) as string).length, 1);

  service.resolveIncident(incident.id);
  assert.equal(JSON.parse(await listIncidentes.invoke({}) as string).length, 0);
  assert.equal(JSON.parse(await listIncidentes.invoke({ status: "resolved" }) as string).length, 1);
  assert.equal(JSON.parse(await listIncidentes.invoke({ status: "all" }) as string).length, 1);
});

test("rejects unsupported incident list statuses", async (context) => {
  const store = new SqliteOpsStore(":memory:");
  context.after(() => store.close());
  const listIncidentes = createListIncidentesTool(new OpsService(store));
  await assert.rejects(listIncidentes.invoke({ status: "mitigated" as never }));
});
