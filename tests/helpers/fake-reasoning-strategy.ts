import type { ReasoningStrategy } from "../../src/strategies/strategy.ts";
import type { StrategyResult } from "../../src/trace/trace.ts";

export class FakeReasoningStrategy implements ReasoningStrategy {
  readonly name = "react" as const;
  readonly inputs: string[] = [];

  constructor(
    private readonly createResult: (input: string) => StrategyResult | Promise<StrategyResult> =
      (input) => ({
        answer: `Answer: ${input}`,
        trace: [{ type: "answer", content: `Answer: ${input}` }],
        metrics: { llmCalls: 1, latencyMs: 5 },
      }),
  ) {}

  async run(input: string): Promise<StrategyResult> {
    this.inputs.push(input);
    return await this.createResult(input);
  }
}
