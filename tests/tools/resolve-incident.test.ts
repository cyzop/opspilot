import assert from "node:assert/strict";
import test from "node:test";
import { OpsService } from "../../src/domain/ops-service.ts";
import { SqliteOpsStore } from "../../src/store/sqlite-ops-store.ts";
import { createResolveIncidentTool } from "../../src/../src/tools/resolve-incident.ts";

test("resolves an open incident, returning the serialized validated record", async (context) => {
  const store = new SqliteOpsStore(":memory:");
  context.after(() => store.close());
  const service = new OpsService(store);
  const resolveIncident = createResolveIncidentTool(service);
  assert.equal(resolveIncident.name, "resolve_incident");

  const opened = service.openIncident({
    title: "Checkout failing",
    service: "checkout",
    severity: "high",
  });
  const resolved = JSON.parse(await resolveIncident.invoke({ id: opened.id }) as string) as {
    status: string;
  };
  assert.equal(resolved.status, "resolved");
});

test("propagates the unknown incident domain error", async (context) => {
  const store = new SqliteOpsStore(":memory:");
  context.after(() => store.close());
  const resolveIncident = createResolveIncidentTool(new OpsService(store));
  await assert.rejects(resolveIncident.invoke({ id: "missing" }), /Unknown incident/);
});

test("through /chat (approval policy) the tool pauses instead of resolving", async (context) => {
  const { runWithApprovalPolicy, HTTP_APPROVAL_POLICY } = await import("../../src/approval/approval-context.ts");
  const { ApprovalRequiredError } = await import("../../src/approval/approval-errors.ts");
  const store = new SqliteOpsStore(":memory:");
  context.after(() => store.close());
  const service = new OpsService(store);
  const resolveIncident = createResolveIncidentTool(service);
  const opened = service.openIncident({ title: "Checkout failing", service: "checkout", severity: "high" });

  const error = await runWithApprovalPolicy(HTTP_APPROVAL_POLICY, () => resolveIncident.invoke({ id: opened.id }))
    .then(() => undefined, (caught: unknown) => caught);
  assert.ok(error instanceof ApprovalRequiredError);
  assert.deepEqual(error.proposal, {
    tool: "resolve_incident",
    args: { id: opened.id },
    target: opened.id,
    description: `Resolver o incidente ${opened.id}`,
  });
  assert.equal(service.listIncidents("open").find(({ id }) => id === opened.id)?.status, "open");

  await assert.rejects(
    runWithApprovalPolicy(HTTP_APPROVAL_POLICY, () => resolveIncident.invoke({ id: "" })),
    (caught: unknown) => !(caught instanceof ApprovalRequiredError),
  );
});
