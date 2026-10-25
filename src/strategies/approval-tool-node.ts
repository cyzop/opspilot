import { ToolMessage } from "@langchain/core/messages";
import type { ToolCall } from "@langchain/core/messages/tool";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import type { LangGraphRunnableConfig } from "@langchain/langgraph";
import { isApprovalRequired } from "../approval/approval-errors.ts";

/**
 * The stock ToolNode turns every tool error into a ToolMessage, so the model would keep going
 * after an approval request. This node lets ApprovalRequiredError escape and keeps the stock
 * error message for every other failure.
 */
export class ApprovalAwareToolNode extends ToolNode {
  constructor(tools: StructuredToolInterface[]) {
    super(tools, { handleToolErrors: false });
  }

  protected override async runTool(call: ToolCall, config: LangGraphRunnableConfig, state: unknown) {
    try {
      return await super.runTool(call, config, state);
    } catch (error) {
      if (isApprovalRequired(error)) throw error;
      return new ToolMessage({
        status: "error",
        content: `Error: ${error instanceof Error ? error.message : String(error)}\n Please fix your mistakes.`,
        name: call.name,
        tool_call_id: call.id ?? "",
      });
    }
  }
}
