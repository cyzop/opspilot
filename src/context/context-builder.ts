import { z } from "zod";
import { conversationMessageSchema, type ConversationMessage } from "../domain/domain.ts";
import { ConfigurationError } from "../domain/errors.ts";
import { estimateTokens, type ContextSections } from "./tokens.ts";

export const SYSTEM_PROMPT = [
  "Você é o OpsPilot, copiloto de plantão para incidentes de produção.",
  "Consulte as ferramentas disponíveis (alertas, incidentes, runbooks, status de provedores) antes de afirmar fatos operacionais; nunca invente dados.",
  "Responda em português, de forma objetiva, indicando impacto e próximos passos.",
  "Nunca exponha segredos, tokens ou credenciais.",
].join("\n");

const budgetValueSchema = z.number().int().nonnegative().safe();

export const contextBudgetSchema = z.object({
  system: budgetValueSchema,
  summary: budgetValueSchema,
  history: budgetValueSchema,
  memories: budgetValueSchema,
}).strict();

export type ContextBudget = z.infer<typeof contextBudgetSchema>;
export type SectionName = keyof ContextBudget;

export const DEFAULT_CONTEXT_BUDGET: ContextBudget = { system: 400, summary: 200, history: 1200, memories: 300 };
export const UNLIMITED_CONTEXT_BUDGET: ContextBudget = {
  system: Number.MAX_SAFE_INTEGER,
  summary: Number.MAX_SAFE_INTEGER,
  history: Number.MAX_SAFE_INTEGER,
  memories: Number.MAX_SAFE_INTEGER,
};

const BUDGET_ENV: Record<SectionName, string> = {
  system: "CONTEXT_BUDGET_SYSTEM",
  summary: "CONTEXT_BUDGET_SUMMARY",
  history: "CONTEXT_BUDGET_HISTORY",
  memories: "CONTEXT_BUDGET_MEMORIES",
};

export const sectionCutSchema = z.enum(["never", "oldest-first", "lowest-score-first"]);
export type SectionCut = z.infer<typeof sectionCutSchema>;

export const sectionReportSchema = z.object({
  budget: budgetValueSchema,
  cut: sectionCutSchema,
  keptTokens: z.number().int().nonnegative(),
  droppedItems: z.number().int().nonnegative(),
  droppedTokens: z.number().int().nonnegative(),
  overBudget: z.boolean(),
}).strict();

export const contextBudgetReportSchema = z.object({
  system: sectionReportSchema,
  summary: sectionReportSchema,
  history: sectionReportSchema,
  memories: sectionReportSchema,
}).strict();

export type SectionReport = z.infer<typeof sectionReportSchema>;
export type ContextBudgetReport = z.infer<typeof contextBudgetReportSchema>;

export interface MemoryItem {
  readonly fact: string;
  readonly score: number;
}

export interface BuildContextInput {
  readonly message: string;
  readonly history?: readonly ConversationMessage[];
  readonly summary?: string | null;
  readonly memories?: readonly MemoryItem[];
  readonly budget: ContextBudget;
  readonly systemPrompt?: string;
}

export interface BuiltContext {
  readonly prompt: string;
  readonly sections: Required<ContextSections>;
  readonly report: ContextBudgetReport;
}

interface SectionItem {
  readonly text: string;
  readonly score: number;
}

interface Section {
  readonly name: SectionName;
  readonly header: string;
  readonly items: readonly SectionItem[];
  readonly budget: number;
  readonly cut: SectionCut;
}

interface FittedSection {
  readonly name: SectionName;
  readonly rendered: string;
  readonly report: SectionReport;
}

const HEADERS: Record<SectionName, string> = {
  system: "System instructions:",
  summary: "Conversation summary (older messages):",
  history: "Conversation history (oldest first):",
  memories: "Semantic memory (relevant facts):",
};

function render(header: string, items: readonly SectionItem[]): string {
  return items.length === 0 ? "" : [header, ...items.map(({ text }) => text)].join("\n");
}

function section(
  name: SectionName,
  items: readonly SectionItem[],
  options: { budget: number; cut: SectionCut },
): Section {
  return { name, header: HEADERS[name], items, ...options };
}

// Keeps items in priority order while the rendered section fits; stops at the first misfit so a
// lower-priority item is never kept in place of a higher-priority one.
function keepWhileFits(header: string, prioritized: readonly SectionItem[], budget: number): SectionItem[] {
  const kept: SectionItem[] = [];
  for (const item of prioritized) {
    if (estimateTokens(render(header, [...kept, item])) > budget) break;
    kept.push(item);
  }
  return kept;
}

function fitToBudget(input: Section): FittedSection {
  const untrimmed = estimateTokens(render(input.header, input.items));
  let kept: readonly SectionItem[];
  if (input.cut === "never") {
    kept = input.items;
  } else if (input.cut === "oldest-first") {
    kept = keepWhileFits(input.header, [...input.items].reverse(), input.budget).reverse();
  } else {
    const byScore = input.items
      .map((item, index) => ({ item, index }))
      .sort((left, right) => right.item.score - left.item.score || left.index - right.index)
      .map(({ item }) => item);
    kept = keepWhileFits(input.header, byScore, input.budget);
  }
  const rendered = render(input.header, kept);
  const keptTokens = estimateTokens(rendered);
  return {
    name: input.name,
    rendered,
    report: sectionReportSchema.parse({
      budget: input.budget,
      cut: input.cut,
      keptTokens,
      droppedItems: input.items.length - kept.length,
      droppedTokens: Math.max(0, untrimmed - keptTokens),
      overBudget: input.cut === "never" && keptTokens > input.budget,
    }),
  };
}

function assemble(fitted: readonly FittedSection[], message: string): BuiltContext {
  const byName = Object.fromEntries(fitted.map((item) => [item.name, item])) as Record<SectionName, FittedSection>;
  const messageSection = `Current message:\nUser: ${message}`;
  return {
    prompt: [...fitted.map(({ rendered }) => rendered), messageSection].filter((part) => part !== "").join("\n"),
    sections: {
      system: byName.system.rendered,
      summary: byName.summary.rendered,
      history: byName.history.rendered,
      memory: byName.memories.rendered,
      message: messageSection,
    },
    report: contextBudgetReportSchema.parse({
      system: byName.system.report,
      summary: byName.summary.report,
      history: byName.history.report,
      memories: byName.memories.report,
    }),
  };
}

export function buildContext(input: BuildContextInput): BuiltContext {
  const budget = contextBudgetSchema.parse(input.budget);
  const history = (input.history ?? []).map((item) => conversationMessageSchema.parse(item));
  const summary = input.summary?.trim() ?? "";
  const sections = [
    section("system", [{ text: input.systemPrompt ?? SYSTEM_PROMPT, score: 0 }], { budget: budget.system, cut: "never" }),
    section("summary", summary ? [{ text: summary, score: 0 }] : [], { budget: budget.summary, cut: "never" }),
    section(
      "history",
      history.map(({ role, content }) => ({ text: `${role === "user" ? "User" : "Assistant"}: ${content}`, score: 0 })),
      { budget: budget.history, cut: "oldest-first" },
    ),
    section(
      "memories",
      (input.memories ?? []).map(({ fact, score }) => ({ text: `- ${fact}`, score })),
      { budget: budget.memories, cut: "lowest-score-first" },
    ),
  ];
  return assemble(sections.map(fitToBudget), input.message);
}

export function loadContextBudget(env: Record<string, string | undefined> = process.env): ContextBudget {
  const entries = (Object.keys(BUDGET_ENV) as SectionName[]).map((name) => {
    const variable = BUDGET_ENV[name];
    const raw = env[variable];
    if (raw === undefined) return [name, DEFAULT_CONTEXT_BUDGET[name]] as const;
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value)) {
      throw new ConfigurationError(`${variable} must be a non-negative integer (got "${raw}")`);
    }
    return [name, value] as const;
  });
  return contextBudgetSchema.parse(Object.fromEntries(entries));
}
