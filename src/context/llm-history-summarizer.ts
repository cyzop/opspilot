import { HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { createModel } from "../llm/model.ts";
import type { HistorySummarizer, SummarizerInput } from "./conversation-history.ts";

export const SUMMARIZE_PROMPT = `Comprima o trecho de conversa a seguir em no máximo 150 tokens, preservando obrigatoriamente: decisões tomadas, fatos estabelecidos (nomes, datas, prazos, preferências), incidentes abertos/resolvidos e pendências abertas. Descarte cumprimentos e conversa social. Se houver um resumo anterior, incorpore-o.
Responda só o resumo, em tópicos telegráficos.`;

export function summarizerMessages(input: SummarizerInput): BaseMessage[] {
  const transcript = input.messages
    .map(({ role, content }, index) => `${index + 1}. ${role === "user" ? "User" : "Assistant"}: ${content}`)
    .join("\n");
  return [
    new SystemMessage(SUMMARIZE_PROMPT),
    new HumanMessage([
      `Resumo anterior:\n${input.previousSummary ?? "nenhum"}`,
      `Trecho da conversa:\n${transcript}`,
    ].join("\n\n")),
  ];
}

function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part !== null && typeof part === "object" && "text" in part ? String(part.text) : ""))
      .join("");
  }
  return "";
}

export function createLlmHistorySummarizer(model?: BaseChatModel): HistorySummarizer {
  let resolved = model;
  return async (input) => {
    resolved ??= createModel();
    const response = await resolved.invoke(summarizerMessages(input));
    return messageText(response.content);
  };
}
