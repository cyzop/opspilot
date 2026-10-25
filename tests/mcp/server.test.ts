import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function connectToOpsPilot(context: test.TestContext): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "src/mcp/server.ts"],
    cwd: process.cwd(),
    env: { ...process.env, OPSPILOT_DB: ":memory:" },
  });
  const client = new Client({ name: "opspilot-integration-test", version: "1.0.0" });
  context.after(async () => client.close());
  await client.connect(transport);
  return client;
}

function resultText(result: unknown): string {
  if (
    typeof result !== "object"
    || result === null
    || !("content" in result)
    || !Array.isArray(result.content)
  ) {
    throw new Error("MCP result did not contain content.");
  }

  const [content] = result.content;
  if (
    typeof content !== "object"
    || content === null
    || !("type" in content)
    || content.type !== "text"
    || !("text" in content)
    || typeof content.text !== "string"
  ) {
    throw new Error("MCP result did not contain text content.");
  }
  return content.text;
}

test("starts over stdio and advertises exactly the public OpsPilot tools", async (context) => {
  const client = await connectToOpsPilot(context);

  assert.equal(client.getServerVersion()?.name, "opspilot");
  const { tools } = await client.listTools();
  assert.deepEqual(
    tools.map(({ name }) => name).sort(),
    ["list_alerts", "list_incidentes", "open_incident", "resolve_incident"],
  );
});

test("lists alerts and shares incident state across MCP calls", async (context) => {
  const client = await connectToOpsPilot(context);

  const defaultAlerts = await client.callTool({ name: "list_alerts", arguments: {} });
  const allAlerts = await client.callTool({
    name: "list_alerts",
    arguments: { status: "all" },
  });
  assert.equal(JSON.parse(resultText(defaultAlerts)).length, 3);
  assert.equal(JSON.parse(resultText(allAlerts)).length, 6);

  const opened = await client.callTool({
    name: "open_incident",
    arguments: {
      title: "Checkout failing",
      service: "checkout",
      severity: "high",
    },
  });
  const incident = JSON.parse(resultText(opened)) as { id: string; status: string };
  assert.equal(incident.status, "open");

  const openIncidents = await client.callTool({ name: "list_incidentes", arguments: {} });
  assert.deepEqual(
    (JSON.parse(resultText(openIncidents)) as { id: string }[]).map(({ id }) => id),
    [incident.id],
  );

  const resolved = await client.callTool({
    name: "resolve_incident",
    arguments: { id: incident.id },
  });
  const resolvedIncident = JSON.parse(resultText(resolved)) as { id: string; status: string };
  assert.equal(resolvedIncident.id, incident.id);
  assert.equal(resolvedIncident.status, "resolved");
});

test("reports input and domain failures as tool errors and remains usable", async (context) => {
  const client = await connectToOpsPilot(context);

  const invalidInput = await client.callTool({
    name: "list_alerts",
    arguments: { status: "unknown" },
  });
  assert.equal(invalidInput.isError, true);

  const unknownField = await client.callTool({
    name: "open_incident",
    arguments: { title: "Checkout failing", service: "checkout", severity: "high", extra: 1 },
  });
  assert.equal(unknownField.isError, true);
  const afterRejected = await client.callTool({ name: "list_incidentes", arguments: { status: "all" } });
  assert.equal(JSON.parse(resultText(afterRejected)).length, 0);

  const unknownIncident = await client.callTool({
    name: "resolve_incident",
    arguments: { id: "missing-incident" },
  });
  assert.equal(unknownIncident.isError, true);
  assert.match(resultText(unknownIncident), /unknown incident/i);

  const validCall = await client.callTool({
    name: "list_alerts",
    arguments: {},
  });
  assert.equal(validCall.isError, undefined);
  assert.equal(JSON.parse(resultText(validCall)).length, 3);
});
