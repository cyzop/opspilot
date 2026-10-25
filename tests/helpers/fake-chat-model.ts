import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, type BaseMessage } from "@langchain/core/messages";
import type { ChatResult } from "@langchain/core/outputs";
import { RunnableLambda, type Runnable } from "@langchain/core/runnables";

export type FakeStep = Error | string | Record<string, unknown>;
export type FakeScript = readonly FakeStep[] | (() => FakeStep);
export type FakeCallMethod = "invoke" | "tools" | "structured";

/** Error with an HTTP-like `status`, as provider SDKs throw. */
export function httpError(status: number, message = `HTTP ${status}`): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

class ScriptedChatModel extends BaseChatModel {
  readonly calls: { method: FakeCallMethod; input: unknown }[] = [];
  private nextMethod: FakeCallMethod = "invoke";
  private index = 0;

  constructor(private readonly fakeName: string, private readonly script: FakeScript) {
    super({});
  }

  _llmType(): string {
    return `fake:${this.fakeName}`;
  }

  private step(): FakeStep {
    if (typeof this.script === "function") return this.script();
    const step = this.script[Math.min(this.index, this.script.length - 1)];
    this.index += 1;
    if (step === undefined) throw new Error(`Fake model ${this.fakeName} has an empty script`);
    return step;
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const method = this.nextMethod;
    this.nextMethod = "invoke";
    this.calls.push({ method, input: messages });
    const step = this.step();
    if (step instanceof Error) throw step;
    const text = typeof step === "string" ? step : JSON.stringify(step);
    return { generations: [{ text, message: new AIMessage(text) }] };
  }

  private viaInvoke(method: FakeCallMethod): Runnable {
    return RunnableLambda.from(async (input: BaseMessage[] | string, config) => {
      this.nextMethod = method;
      return this.invoke(input, config);
    });
  }

  override bindTools(): Runnable {
    return this.viaInvoke("tools");
  }

  override withStructuredOutput(): Runnable<any, any> {
    return this.viaInvoke("structured").pipe(RunnableLambda.from((message: AIMessage) => {
      return JSON.parse(String(message.content)) as unknown;
    }));
  }
}

/**
 * Scripted chat model: each call consumes the next step (the last step repeats).
 * An Error step is thrown; a string is the reply; an object is the structured output.
 */
export function createFakeChatModel(name: string, script: FakeScript) {
  const model = new ScriptedChatModel(name, script);
  return { model, calls: model.calls };
}
