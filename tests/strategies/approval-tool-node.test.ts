import assert from "node:assert/strict";
import test from "node:test";
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { ApprovalRequiredError } from "../../src/approval/approval-errors.ts";
import { proposeResolution } from "../../src/approval/approval-service.ts";
import { ApprovalAwareToolNode } from "../../src/strategies/approval-tool-node.ts";

const paused = tool(async () => {
  throw new ApprovalRequiredError(proposeResolution("incident-001"));
}, { name: "resolve_incident", description: "x", schema: z.object({ id: z.string() }) });

const broken = tool(async () => {
  throw new Error("database offline");
}, { name: "list_alerts", description: "x", schema: z.object({}) });

const call = (name: string, args: Record<string, unknown>) => ({
  messages: [new AIMessage({ content: "", tool_calls: [{ id: "c1", name, args, type: "tool_call" as const }] })],
});

test("ApprovalRequiredError escapes the tool node", async () => {
  const node = new ApprovalAwareToolNode([paused, broken]);
  await assert.rejects(node.invoke(call("resolve_incident", { id: "incident-001" })), ApprovalRequiredError);
});

test("other tool errors still become the stock error ToolMessage", async () => {
  const node = new ApprovalAwareToolNode([paused, broken]);
  const output = await node.invoke(call("list_alerts", {})) as { messages: ToolMessage[] };
  const message = output.messages[0];
  assert.ok(message instanceof ToolMessage);
  assert.equal(message.status, "error");
  assert.equal(message.content, "Error: database offline\n Please fix your mistakes.");
  assert.equal(message.name, "list_alerts");
  assert.equal(message.tool_call_id, "c1");
});
