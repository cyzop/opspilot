import { z } from "zod";

const tokenCountSchema = z.number().int().nonnegative();

const llmResultUsageSchema = z.object({
  generations: z.array(z.array(z.object({
    message: z.object({
      usage_metadata: z.object({ input_tokens: z.unknown() }).optional(),
    }).optional(),
  }))),
  llmOutput: z.object({
    tokenUsage: z.object({ promptTokens: z.unknown() }).optional(),
  }).nullish(),
});

export const contextBreakdownSchema = z.object({
  method: z.literal("chars/4"),
  system: tokenCountSchema,
  history: tokenCountSchema,
  memory: tokenCountSchema,
  summary: tokenCountSchema,
  message: tokenCountSchema,
  total: tokenCountSchema,
}).strict();

export type ContextBreakdown = z.infer<typeof contextBreakdownSchema>;

export interface ContextSections {
  readonly system?: string;
  readonly history: string;
  readonly memory: string;
  readonly summary?: string;
  readonly message: string;
}

export interface UsageCallback {
  handleLLMEnd(output: unknown): void;
}

export interface UsageRecorder {
  readonly handler: UsageCallback;
  promptTokens(): number | null;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function inputTokensFromLlmResult(output: unknown): number | null {
  const parsed = llmResultUsageSchema.safeParse(output);
  if (!parsed.success) return null;

  const usages = parsed.data.generations
    .flat()
    .map((generation) => generation.message?.usage_metadata);
  if (usages.length > 0 && usages.every((usage) => usage !== undefined)) {
    const counts = usages.map((usage) => tokenCountSchema.safeParse(usage?.input_tokens));
    return counts.every((count) => count.success)
      ? sumPromptTokens(counts.map((count) => count.data ?? null))
      : null;
  }

  const fallback = tokenCountSchema.safeParse(parsed.data.llmOutput?.tokenUsage?.promptTokens);
  return fallback.success ? fallback.data : null;
}

export function sumPromptTokens(values: readonly (number | null)[]): number | null {
  if (values.length === 0) return null;
  let total = 0;
  for (const value of values) {
    if (value === null) return null;
    total += value;
  }
  return total;
}

export function createUsageRecorder(): UsageRecorder {
  const recorded: (number | null)[] = [];
  return {
    handler: {
      handleLLMEnd(output: unknown) {
        recorded.push(inputTokensFromLlmResult(output));
      },
    },
    promptTokens() {
      return sumPromptTokens(recorded);
    },
  };
}

export function estimateContextBreakdown(sections: ContextSections): ContextBreakdown {
  const system = estimateTokens(sections.system ?? "");
  const history = estimateTokens(sections.history);
  const memory = estimateTokens(sections.memory);
  const summary = estimateTokens(sections.summary ?? "");
  const message = estimateTokens(sections.message);
  return contextBreakdownSchema.parse({
    method: "chars/4",
    system,
    history,
    memory,
    summary,
    message,
    total: system + history + memory + summary + message,
  });
}
