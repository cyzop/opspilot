import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";

export type ToolCallingStep = string | { tool: string; args: Record<string, unknown> };

/** Scripted chat model that can emit tool calls, for running the real ReAct agent. */
export class FakeToolCallingModel extends BaseChatModel {
  readonly inputs: BaseMessage[][] = [];
  private index = 0;

  constructor(private readonly script: readonly ToolCallingStep[]) {
    super({});
  }

  _llmType(): string {
    return "fake-tool-calling";
  }

  override bindTools(): this {
    return this;
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    this.inputs.push(messages);
    const step = this.script[Math.min(this.index, this.script.length - 1)];
    this.index += 1;
    if (step === undefined) throw new Error("FakeToolCallingModel has an empty script");
    const message = typeof step === "string"
      ? new AIMessage(step)
      : new AIMessage({
        content: "",
        tool_calls: [{ id: `call-${this.index}`, name: step.tool, args: step.args, type: "tool_call" }],
      });
    return { generations: [{ text: typeof step === "string" ? step : "", message }] };
  }
}
