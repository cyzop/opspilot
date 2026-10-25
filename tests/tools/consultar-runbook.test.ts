import assert from "node:assert/strict";
import test from "node:test";
import { OpsService } from "../../src/domain/ops-service.ts";
import { SqliteOpsStore } from "../../src/store/sqlite-ops-store.ts";
import { createConsultarRunbookTool } from "../../src/tools/consultar-runbook.ts";

test("returns the requested service runbook", async (context) => {
  const store = new SqliteOpsStore(":memory:");
  context.after(() => store.close());
  const consultarRunbook = createConsultarRunbookTool(new OpsService(store));

  assert.equal(consultarRunbook.name, "consultar_runbook");
  const runbook = JSON.parse(await consultarRunbook.invoke({ service: "payments" }) as string) as {
    service: string;
    steps: string[];
  };
  assert.equal(runbook.service, "payments");
  assert.ok(runbook.steps.length > 0);
});

test("rejects unknown runbooks", async (context) => {
  const store = new SqliteOpsStore(":memory:");
  context.after(() => store.close());
  const consultarRunbook = createConsultarRunbookTool(new OpsService(store));
  await assert.rejects(consultarRunbook.invoke({ service: "missing" }), /Unknown runbook/);
});
