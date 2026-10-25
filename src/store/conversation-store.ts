import type {
  Conversation,
  ConversationMessage,
  ConversationSummary,
  NewConversationMessage,
} from "../domain/domain.ts";

export type ConversationExchange = readonly [
  userMessage: NewConversationMessage,
  assistantMessage: NewConversationMessage,
];

export interface ConversationStore {
  create(): Conversation;
  get(conversationId: string): Conversation | undefined;
  append(conversationId: string, exchange: ConversationExchange): ConversationMessage[];
  lastMessages(conversationId: string, limit: number): ConversationMessage[];
  messagesAfter(conversationId: string, afterMessageId: number): ConversationMessage[];
  getSummary(conversationId: string): ConversationSummary | undefined;
  saveSummary(summary: ConversationSummary): boolean;
  close(): void;
}
