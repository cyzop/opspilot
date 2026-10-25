import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { OpsStore } from "../store/ops-store.ts";
import { SqliteOpsStore } from "../store/sqlite-ops-store.ts";
import { createOpsTools } from "../tools/index.ts";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function invokeTool(operation: () => Promise<unknown>) {
  try {
    return {
      content: [{ type: "text" as const, text: String(await operation()) }],
    };
  } catch (error) {
    return {
      content: [{ type: "text" as const, text: errorText(error) }],
      isError: true,
    };
  }
}

export function createOpsPilotMcpServer(store: OpsStore): McpServer {
  const tools = createOpsTools(store);
  const server = new McpServer({ name: "opspilot", version: "1.0.0" });

  server.registerTool(
    "list_alerts",
    {
      description: tools.listAlerts.description,
      inputSchema: tools.listAlerts.schema,
    },
    (input) => invokeTool(() => tools.listAlerts.invoke(input)),
  );

  server.registerTool(
    "list_incidentes",
    {
      description: tools.listIncidentes.description,
      inputSchema: tools.listIncidentes.schema,
    },
    (input) => invokeTool(() => tools.listIncidentes.invoke(input)),
  );

  server.registerTool(
    "open_incident",
    {
      description: tools.openIncident.description,
      inputSchema: tools.openIncident.schema,
    },
    (input) => invokeTool(() => tools.openIncident.invoke(input)),
  );

  server.registerTool(
    "resolve_incident",
    {
      description: tools.resolveIncident.description,
      inputSchema: tools.resolveIncident.schema,
    },
    (input) => invokeTool(() => tools.resolveIncident.invoke(input)),
  );

  return server;
}

async function main(): Promise<void> {
  const store = new SqliteOpsStore();
  const server = createOpsPilotMcpServer(store);
  const transport = new StdioServerTransport();
  let storeClosed = false;
  const closeStore = () => {
    if (storeClosed) return;
    storeClosed = true;
    store.close();
  };

  process.stdin.once("end", closeStore);
  process.once("SIGINT", () => {
    void server.close().finally(closeStore);
  });
  process.once("SIGTERM", () => {
    void server.close().finally(closeStore);
  });

  try {
    await server.connect(transport);
  } catch (error) {
    closeStore();
    throw error;
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`OpsPilot MCP server failed: ${errorText(error)}\n`);
  process.exitCode = 1;
});
