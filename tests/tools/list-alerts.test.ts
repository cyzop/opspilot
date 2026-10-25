import assert from "node:assert/strict";
import test from "node:test";
import { OpsService } from "../../src/domain/ops-service.ts";
import { SqliteOpsStore } from "../../src/store/sqlite-ops-store.ts";
import { createListAlertsTool } from "../../src/../src/tools/list-alerts.ts";

test("describes when to use list_alerts and defaults alert status to firing", async (context) => {
  const store = new SqliteOpsStore(":memory:");
  context.after(() => store.close());
  const listAlerts = createListAlertsTool(new OpsService(store));
  assert.equal(listAlerts.name, "list_alerts");
  assert.match(listAlerts.description, /o que está disparando/i);
  assert.match(listAlerts.description, /firing \| resolved \| all/);

  const result = await listAlerts.invoke({});
  assert.equal(typeof result, "string");
  assert.equal(JSON.parse(result as string).length, 3);
});

test("rejects an unknown alert status", async (context) => {
  const store = new SqliteOpsStore(":memory:");
  context.after(() => store.close());
  const listAlerts = createListAlertsTool(new OpsService(store));
  await assert.rejects(listAlerts.invoke({ status: "unknown" as never }));
});
