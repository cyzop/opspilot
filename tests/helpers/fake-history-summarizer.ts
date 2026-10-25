import type { HistorySummarizer, SummarizerInput } from "../../src/context/conversation-history.ts";

export interface FakeHistorySummarizerOptions {
  output?: (input: SummarizerInput) => string;
  error?: Error;
}

export function defaultFakeSummary(input: SummarizerInput): string {
  return [input.previousSummary, ...input.messages.map(({ role, content }) => `${role}: ${content}`)]
    .filter((part): part is string => Boolean(part))
    .join(" | ")
    .slice(0, 600);
}

export function createFakeHistorySummarizer(options: FakeHistorySummarizerOptions = {}) {
  const calls: SummarizerInput[] = [];
  const summarizer: HistorySummarizer = async (input) => {
    calls.push(input);
    if (options.error) throw options.error;
    return (options.output ?? defaultFakeSummary)(input);
  };
  return { summarizer, calls };
}
