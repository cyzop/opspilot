import assert from "node:assert/strict";
import type { Server } from "node:http";
import test from "node:test";
import { createChatServer } from "../../src/http/server.ts";
import type { StrategyRegistry } from "../../src/agentes/index.ts";
import type { Memory, MemoryRecallResult } from "../../src/domain/domain.ts";
import { SqliteMemoryStore, type MemoryStore } from "../../src/memory/memory-store.ts";
import { SqliteConversationStore } from "../../src/store/sqlite-conversation-store.ts";
import { FakeReasoningStrategy } from "../helpers/fake-reasoning-strategy.ts";
import { createFakeEmbedder, normalizedVector } from "../helpers/fake-embedder.ts";
import { createFakeHistorySummarizer } from "../helpers/fake-history-summarizer.ts";
import { createFakeRouter } from "../helpers/fake-router.ts";
import { captureLogs } from "../helpers/capture-logs.ts";
import { ModelUnavailableError } from "../../src/domain/errors.ts";
import { reportModelFallback } from "../../src/llm/model-events.ts";
import { SqliteRequestStore } from "../../src/store/sqlite-request-store.ts";
import type { RequestStore } from "../../src/store/request-store.ts";
import { SqliteApprovalStore } from "../../src/approval/sqlite-approval-store.ts";

// Every test server gets a fake router so no test ever reaches the real routing model.
function chatServer(options: Parameters<typeof createChatServer>[0] = {}) {
  return createChatServer({
    router: createFakeRouter("react").router,
    models: { primary: "fake/primary" },
    requestStore: new SqliteRequestStore(":memory:"),
    approvalStore: new SqliteApprovalStore(":memory:"),
    ...options,
  });
}
import { SYSTEM_PROMPT } from "../../src/context/context-builder.ts";
import { withReflection } from "../../src/strategies/reflection.ts";

const SYSTEM_SECTION = `System instructions:\n${SYSTEM_PROMPT}`;
const framed = (...lines: string[]) => [SYSTEM_SECTION, ...lines].join("\n");
const bare = (message: string) => framed("Current message:", `User: ${message}`);

class FakeMemoryStore implements MemoryStore {
  readonly calls: Array<[string, string]> = [];
  constructor(
    private readonly results: MemoryRecallResult[] = [],
    private readonly error?: Error,
  ) {}

  async remember(): Promise<{ memory: Memory; inserted: boolean }> {
    throw new Error("Unexpected remember call");
  }

  async recall(userId: string, query: string): Promise<MemoryRecallResult[]> {
    this.calls.push([userId, query]);
    if (this.error) {
      throw this.error;
    }
    return this.results;
  }

  forget(): boolean {
    throw new Error("Unexpected forget call");
  }
}

function registryFor(strategy: FakeReasoningStrategy): StrategyRegistry {
  return {
    resolve(name: string) {
      if (name !== "react") {
        throw new Error(`Unexpected strategy: ${name}`);
      }
      return strategy;
    },
  };
}

async function listen(app: ReturnType<typeof createChatServer>) {
  const server = app.listen(0);
  await new Promise<void>((resolve) => {
    server.once("listening", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Server address unavailable");
  }
  return { server, port: address.port };
}

async function close(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

test("POST /chat creates a conversation and persists a successful exchange", async (context) => {
  const store = new SqliteConversationStore(":memory:");
  context.after(() => store.close());
  const strategy = new FakeReasoningStrategy();
  const app = chatServer({
    registry: registryFor(strategy),
    conversationStore: store,
    timeoutMs: 2000,
  });
  const { server, port } = await listen(app);
  context.after(() => close(server));

  const response = await fetch(`http://127.0.0.1:${port}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Check the service status" }),
  });

  assert.equal(response.status, 200);
  const payload = await response.json() as {
    answer: string;
    trace: unknown[];
    metrics: { llmCalls: number; latencyMs: number; historyMessages: number };
    conversationId: string;
  };
  assert.equal(payload.answer, `Answer: ${bare("Check the service status")}`);
  assert.deepEqual((payload.trace as Array<{ type: string; node: string }>).map(({ type, node }) => `${type}:${node}`), ["route:router", "answer:react"]);
  assert.equal(payload.metrics.historyMessages, 0);
  assert.ok(payload.conversationId);
  assert.deepEqual(store.lastMessages(payload.conversationId, 12).map(({ role }) => role), [
    "user",
    "assistant",
  ]);
});

test("POST /chat reuses an existing conversation and reports unknown IDs as 404", async (context) => {
  const store = new SqliteConversationStore(":memory:");
  context.after(() => store.close());
  const conversation = store.create();
  const strategy = new FakeReasoningStrategy();
  const app = chatServer({ registry: registryFor(strategy), conversationStore: store });
  const { server, port } = await listen(app);
  context.after(() => close(server));

  const response = await fetch(`http://127.0.0.1:${port}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Follow up", conversationId: conversation.id }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json() as { conversationId: string };
  assert.equal(payload.conversationId, conversation.id);

  const unknownResponse = await fetch(`http://127.0.0.1:${port}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Unknown thread", conversationId: "not-found" }),
  });
  assert.equal(unknownResponse.status, 404);
  assert.match((await unknownResponse.json() as { error: string }).error, /Unknown conversation/);
  assert.equal(strategy.inputs.length, 1);
});

test("POST /chat rejects malformed request bodies with 400 without executing the strategy", async (context) => {
  const store = new SqliteConversationStore(":memory:");
  context.after(() => store.close());
  const strategy = new FakeReasoningStrategy();
  const app = chatServer({ registry: registryFor(strategy), conversationStore: store });
  const { server, port } = await listen(app);
  context.after(() => close(server));

  const response = await fetch(`http://127.0.0.1:${port}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ strategy: "react", conversationId: " " }),
  });

  assert.equal(response.status, 400);
  assert.equal(strategy.inputs.length, 0);
});

test("POST /chat rejects unsupported strategies with 422", async (context) => {
  const store = new SqliteConversationStore(":memory:");
  context.after(() => store.close());
  const app = chatServer({ conversationStore: store, timeoutMs: 2000 });
  const { server, port } = await listen(app);
  context.after(() => close(server));

  const response = await fetch(`http://127.0.0.1:${port}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Any question", strategy: "custom" }),
  });

  assert.equal(response.status, 422);
  assert.match((await response.json() as { error: string }).error, /Unknown strategy/);
});

test("POST /chat returns 504 on timeout without persisting a message pair", async (context) => {
  const store = new SqliteConversationStore(":memory:");
  context.after(() => store.close());
  const strategy = new FakeReasoningStrategy(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    return { answer: "late", trace: [{ type: "answer", content: "late" }], metrics: { llmCalls: 1, latencyMs: 5 } };
  });
  const app = chatServer({
    registry: registryFor(strategy),
    conversationStore: store,
    timeoutMs: 10,
  });
  const { server, port } = await listen(app);
  context.after(() => close(server));

  const response = await fetch(`http://127.0.0.1:${port}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Delayed question" }),
  });

  assert.equal(response.status, 504);
  assert.match((await response.json() as { error: string }).error, /timed out/i);
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(store._db.prepare("SELECT COUNT(*) AS count FROM messages").get()?.count, 0);
});

test("POST /chat summarizes messages that left the 8-message window and reports the history count", async (context) => {
  const store = new SqliteConversationStore(":memory:");
  context.after(() => store.close());
  const conversation = store.create();
  for (let index = 0; index < 8; index += 1) {
    store.append(conversation.id, [
      { role: "user", content: `Question ${index}` },
      { role: "assistant", content: `Answer ${index}` },
    ]);
  }
  const strategy = new FakeReasoningStrategy();
  const fake = createFakeHistorySummarizer();
  const app = chatServer({
    registry: registryFor(strategy),
    conversationStore: store,
    summarizer: fake.summarizer,
  });
  const { server, port } = await listen(app);
  context.after(() => close(server));

  const response = await fetch(`http://127.0.0.1:${port}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Current question", conversationId: conversation.id }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json() as { metrics: { historyMessages: number } };
  assert.equal(payload.metrics.historyMessages, 8);
  assert.equal(fake.calls.length, 1);
  assert.equal(strategy.inputs[0], [
    SYSTEM_SECTION,
    "Conversation summary (older messages):",
    "user: Question 0 | assistant: Answer 0 | user: Question 1 | assistant: Answer 1 | "
      + "user: Question 2 | assistant: Answer 2 | user: Question 3 | assistant: Answer 3",
    "Conversation history (oldest first):",
    ...Array.from({ length: 4 }, (_, index) => [
      `User: Question ${index + 4}`,
      `Assistant: Answer ${index + 4}`,
    ]).flat(),
    "Current message:",
    "User: Current question",
  ].join("\n"));
});

test("POST /chat composes all prior messages verbatim below the summarization threshold", async () => {
  for (const priorCount of [0, 4, 8, 14]) {
    const store = new SqliteConversationStore(":memory:");
    const conversation = store.create();
    for (let index = 0; index < priorCount / 2; index += 1) {
      const role = index % 2 === 0 ? "user" : "assistant";
      store.append(conversation.id, role === "user"
        ? [
          { role: "user", content: `Prior ${index}` },
          { role: "assistant", content: `Pair ${index}` },
        ]
        : [
          { role: "user", content: `Pair ${index}` },
          { role: "assistant", content: `Prior ${index}` },
        ]);
    }
    const strategy = new FakeReasoningStrategy();
    const fake = createFakeHistorySummarizer();
    const app = chatServer({
      registry: registryFor(strategy),
      conversationStore: store,
      summarizer: fake.summarizer,
    });
    const { server, port } = await listen(app);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "Current", conversationId: conversation.id }),
      });
      assert.equal(response.status, 200);
      const payload = await response.json() as { metrics: { historyMessages: number } };
      assert.equal(payload.metrics.historyMessages, priorCount);
      assert.equal(fake.calls.length, 0);
      if (priorCount === 0) {
        assert.equal(strategy.inputs[0], bare("Current"));
      } else {
        assert.ok(strategy.inputs[0]?.endsWith("User: Current"));
        assert.equal((strategy.inputs[0]?.match(/Prior \d+/g) ?? []).length, priorCount / 2);
      }
    } finally {
      await close(server);
      store.close();
    }
  }
});

test("POST /chat does not persist a partial exchange when the strategy fails", async (context) => {
  const store = new SqliteConversationStore(":memory:");
  context.after(() => store.close());
  const strategy = new FakeReasoningStrategy(() => {
    throw new Error("strategy failed");
  });
  const app = chatServer({ registry: registryFor(strategy), conversationStore: store });
  const { server, port } = await listen(app);
  context.after(() => close(server));

  const response = await fetch(`http://127.0.0.1:${port}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Will fail" }),
  });

  assert.equal(response.status, 500);
  assert.equal(store._db.prepare("SELECT COUNT(*) AS count FROM messages").get()?.count, 0);
});

test("POST /chat prepends recalled facts before conversation history and current message", async (context) => {
  const conversationStore = new SqliteConversationStore(":memory:");
  context.after(() => conversationStore.close());
  const conversation = conversationStore.create();
  conversationStore.append(conversation.id, [
    { role: "user", content: "Earlier question" },
    { role: "assistant", content: "Earlier answer" },
  ]);
  const memoryStore = new FakeMemoryStore([{
    memory: {
      id: "memory-1",
      userId: "user-1",
      fact: "Deployments happen on Tuesdays.",
      embedding: normalizedVector({ 0: 1 }),
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    score: 0.8,
  }]);
  const strategy = new FakeReasoningStrategy();
  const app = chatServer({
    registry: registryFor(strategy),
    conversationStore,
    memoryStore,
  });
  const { server, port } = await listen(app);
  context.after(() => close(server));

  const response = await fetch(`http://127.0.0.1:${port}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "When is the deployment?",
      userId: "user-1",
      conversationId: conversation.id,
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(memoryStore.calls, [["user-1", "When is the deployment?"]]);
  const prompt = strategy.inputs[0] ?? "";
  assert.ok(prompt.indexOf("System instructions:") < prompt.indexOf("Conversation history"));
  assert.ok(prompt.indexOf("Conversation history") < prompt.indexOf("Semantic memory (relevant facts):"));
  assert.ok(prompt.indexOf("Semantic memory (relevant facts):") < prompt.indexOf("Current message:"));
  assert.match(prompt, /- Deployments happen on Tuesdays\./);
});

test("POST /chat skips memory when userId is omitted and rejects blank user IDs", async (context) => {
  const conversationStore = new SqliteConversationStore(":memory:");
  context.after(() => conversationStore.close());
  const memoryStore = new FakeMemoryStore();
  const strategy = new FakeReasoningStrategy();
  const app = chatServer({
    registry: registryFor(strategy),
    conversationStore,
    memoryStore,
  });
  const { server, port } = await listen(app);
  context.after(() => close(server));

  const withoutUser = await fetch(`http://127.0.0.1:${port}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "No memory identity" }),
  });
  assert.equal(withoutUser.status, 200);
  assert.equal(strategy.inputs[0], bare("No memory identity"));
  assert.deepEqual(memoryStore.calls, []);

  const blankUser = await fetch(`http://127.0.0.1:${port}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Invalid identity", userId: " " }),
  });
  assert.equal(blankUser.status, 400);
});

test("POST /chat does not add an empty semantic-memory section", async (context) => {
  const conversationStore = new SqliteConversationStore(":memory:");
  context.after(() => conversationStore.close());
  const memoryStore = new FakeMemoryStore();
  const strategy = new FakeReasoningStrategy();
  const app = chatServer({
    registry: registryFor(strategy),
    conversationStore,
    memoryStore,
  });
  const { server, port } = await listen(app);
  context.after(() => close(server));

  const response = await fetch(`http://127.0.0.1:${port}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "No matching memories", userId: "user-1" }),
  });
  assert.equal(response.status, 200);
  assert.equal(strategy.inputs[0], bare("No matching memories"));
  assert.deepEqual(memoryStore.calls, [["user-1", "No matching memories"]]);
});

test("POST /chat surfaces semantic memory failures as request failures", async (context) => {
  const conversationStore = new SqliteConversationStore(":memory:");
  context.after(() => conversationStore.close());
  const strategy = new FakeReasoningStrategy();
  const app = chatServer({
    registry: registryFor(strategy),
    conversationStore,
    memoryStore: new FakeMemoryStore([], new Error("memory inference failed")),
  });
  const { server, port } = await listen(app);
  context.after(() => close(server));

  const response = await fetch(`http://127.0.0.1:${port}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Use memory", userId: "user-1" }),
  });
  assert.equal(response.status, 500);
  assert.match((await response.json() as { error: string }).error, /memory inference failed/);
  assert.equal(strategy.inputs.length, 0);
});

test("POST /memories stores a fact that a later /chat for the same user recalls", async (context) => {
  const conversationStore = new SqliteConversationStore(":memory:");
  context.after(() => conversationStore.close());
  const { embed } = createFakeEmbedder({
    "Prefers critical alerts first.": normalizedVector({ 0: 1 }),
    "Critical alerts go first.": normalizedVector({ 0: 0.99, 1: 0.05 }),
    "How should I order the alerts?": normalizedVector({ 0: 0.8, 1: 0.6 }),
  });
  const memoryStore = new SqliteMemoryStore(":memory:", { embed });
  context.after(() => memoryStore.close());
  const strategy = new FakeReasoningStrategy();
  const app = chatServer({
    registry: registryFor(strategy),
    conversationStore,
    memoryStore,
  });
  const { server, port } = await listen(app);
  context.after(() => close(server));
  const post = (path: string, body: unknown) => fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const created = await post("/memories", { userId: "u-42", fact: "Prefers critical alerts first." });
  assert.equal(created.status, 201);
  const memory = await created.json() as Record<string, unknown>;
  assert.deepEqual(Object.keys(memory).sort(), ["createdAt", "fact", "id", "inserted", "userId"]);
  assert.equal(memory.userId, "u-42");
  assert.equal(memory.fact, "Prefers critical alerts first.");
  assert.equal(memory.inserted, true);

  const duplicate = await post("/memories", { userId: "u-42", fact: "Critical alerts go first." });
  assert.equal(duplicate.status, 200);
  const reused = await duplicate.json() as Record<string, unknown>;
  assert.equal(reused.id, memory.id);
  assert.equal(reused.fact, "Prefers critical alerts first.");
  assert.equal(reused.inserted, false);

  const chat = await post("/chat", { message: "How should I order the alerts?", userId: "u-42" });
  assert.equal(chat.status, 200);
  assert.match(strategy.inputs[0] ?? "", /- Prefers critical alerts first\./);

  const otherUser = await post("/chat", { message: "How should I order the alerts?", userId: "u-7" });
  assert.equal(otherUser.status, 200);
  assert.equal(strategy.inputs[1], bare("How should I order the alerts?"));
});

test("POST /memories rejects malformed bodies with 400 without calling the store", async (context) => {
  const conversationStore = new SqliteConversationStore(":memory:");
  context.after(() => conversationStore.close());
  const app = chatServer({
    registry: registryFor(new FakeReasoningStrategy()),
    conversationStore,
    memoryStore: new FakeMemoryStore(),
  });
  const { server, port } = await listen(app);
  context.after(() => close(server));

  for (const body of [
    { userId: "u-42" },
    { fact: "Missing user" },
    { userId: " ", fact: "Blank user" },
    { userId: "u-42", fact: " " },
    { userId: "u-42", fact: "Extra field", message: "not allowed" },
  ]) {
    const response = await fetch(`http://127.0.0.1:${port}/memories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal((await response.json() as { error: string }).error, "Invalid request body");
  }
});

test("POST /memories surfaces store failures and a missing store as 500", async (context) => {
  const conversationStore = new SqliteConversationStore(":memory:");
  context.after(() => conversationStore.close());
  const registry = registryFor(new FakeReasoningStrategy());
  const body = JSON.stringify({ userId: "u-42", fact: "Prefers critical alerts first." });

  for (const [memoryStore, expected] of [
    [new FakeMemoryStore(), /Unexpected remember call/],
    [undefined, /not configured/],
  ] as const) {
    const { server, port } = await listen(chatServer({ registry, conversationStore, memoryStore }));
    try {
      const response = await fetch(`http://127.0.0.1:${port}/memories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      assert.equal(response.status, 500);
      assert.match((await response.json() as { error: string }).error, expected);
    } finally {
      await close(server);
    }
  }
});

interface MetricsPayload {
  metrics: {
    promptTokens: number | null;
    contextBreakdown: { method: string; system: number; history: number; memory: number; summary: number; message: number; total: number };
  };
  conversationId: string;
}

async function postChat(port: number, body: Record<string, unknown>): Promise<MetricsPayload> {
  const response = await fetch(`http://127.0.0.1:${port}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 200);
  return await response.json() as MetricsPayload;
}

test("POST /chat reports the real promptTokens of the strategy", async (context) => {
  const store = new SqliteConversationStore(":memory:");
  context.after(() => store.close());
  const strategy = new FakeReasoningStrategy((input) => ({
    answer: `Answer: ${input}`,
    trace: [{ type: "answer", content: `Answer: ${input}` }],
    metrics: { llmCalls: 1, latencyMs: 5, promptTokens: 1234 },
  }));
  const { server, port } = await listen(chatServer({ registry: registryFor(strategy), conversationStore: store }));
  context.after(() => close(server));

  const payload = await postChat(port, { message: "Check the service status", strategy: "react" });
  assert.equal(payload.metrics.promptTokens, 1234);
});

test("POST /chat reports promptTokens as null when the strategy has no usage", async (context) => {
  const store = new SqliteConversationStore(":memory:");
  context.after(() => store.close());
  const { server, port } = await listen(chatServer({
    registry: registryFor(new FakeReasoningStrategy()),
    conversationStore: store,
  }));
  context.after(() => close(server));

  const payload = await postChat(port, { message: "Check the service status" });
  assert.ok("promptTokens" in payload.metrics);
  assert.equal(payload.metrics.promptTokens, null);
});

test("POST /chat estimates the context breakdown of each turn", async (context) => {
  const store = new SqliteConversationStore(":memory:");
  context.after(() => store.close());
  const { server, port } = await listen(chatServer({
    registry: registryFor(new FakeReasoningStrategy()),
    conversationStore: store,
  }));
  context.after(() => close(server));

  const message = "Check the service status";
  const first = await postChat(port, { message });
  const systemTokens = Math.ceil(SYSTEM_SECTION.length / 4);
  const messageTokens = Math.ceil(`Current message:\nUser: ${message}`.length / 4);
  assert.deepEqual(first.metrics.contextBreakdown, {
    method: "chars/4",
    system: systemTokens,
    history: 0,
    memory: 0,
    summary: 0,
    message: messageTokens,
    total: systemTokens + messageTokens,
  });

  const second = await postChat(port, { message: "And now?", conversationId: first.conversationId });
  const breakdown = second.metrics.contextBreakdown;
  assert.ok(breakdown.history > 0);
  assert.equal(breakdown.memory, 0);
  assert.equal(breakdown.total, breakdown.system + breakdown.history + breakdown.memory + breakdown.summary + breakdown.message);
});

test("POST /chat estimates recalled memory in the context breakdown", async (context) => {
  const store = new SqliteConversationStore(":memory:");
  context.after(() => store.close());
  const memoryStore = new FakeMemoryStore([{
    memory: {
      id: "memory-1",
      userId: "user-1",
      fact: "Deployments happen on Tuesdays.",
      embedding: normalizedVector({ 0: 1 }),
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    score: 0.8,
  }]);
  const { server, port } = await listen(chatServer({
    registry: registryFor(new FakeReasoningStrategy()),
    conversationStore: store,
    memoryStore,
    learningReflector: async () => false,
  }));
  context.after(() => close(server));

  const payload = await postChat(port, { message: "When is the deployment?", userId: "user-1" });
  assert.ok(payload.metrics.contextBreakdown.memory > 0);
  assert.equal(payload.metrics.contextBreakdown.history, 0);
});

interface SummarizePayload {
  trace: Array<{ type: string; status?: string }>;
  metrics: { contextBreakdown: { system: number; summary: number; total: number; history: number; memory: number; message: number } };
  answer: string;
}

async function seededConversation(store: SqliteConversationStore, pairs: number): Promise<string> {
  const conversation = store.create();
  for (let index = 0; index < pairs; index += 1) {
    store.append(conversation.id, [
      { role: "user", content: `Question ${index}` },
      { role: "assistant", content: `Answer ${index}` },
    ]);
  }
  return conversation.id;
}

async function chatOn(port: number, conversationId: string, message: string): Promise<SummarizePayload> {
  const response = await fetch(`http://127.0.0.1:${port}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, conversationId }),
  });
  assert.equal(response.status, 200);
  return await response.json() as SummarizePayload;
}

test("POST /chat reports a summarize event only on the threshold turn", async (context) => {
  const store = new SqliteConversationStore(":memory:");
  context.after(() => store.close());
  const conversationId = await seededConversation(store, 8);
  const fake = createFakeHistorySummarizer();
  const { server, port } = await listen(chatServer({
    registry: registryFor(new FakeReasoningStrategy()),
    conversationStore: store,
    summarizer: fake.summarizer,
  }));
  context.after(() => close(server));

  const first = await chatOn(port, conversationId, "What is pending?");
  assert.equal(first.trace[0]?.type, "summarize");
  assert.equal(first.trace[0]?.status, "ok");
  const breakdown = first.metrics.contextBreakdown;
  assert.ok(breakdown.summary > 0);
  assert.equal(breakdown.total, breakdown.system + breakdown.history + breakdown.memory + breakdown.summary + breakdown.message);

  const second = await chatOn(port, conversationId, "And now?");
  assert.ok(second.trace.every(({ type }) => type !== "summarize"));
  assert.ok(second.metrics.contextBreakdown.summary > 0);
  assert.equal(fake.calls.length, 1);
});

test("POST /chat still answers when summarization fails", async (context) => {
  const store = new SqliteConversationStore(":memory:");
  context.after(() => store.close());
  const conversationId = await seededConversation(store, 8);
  captureLogs(context);
  const { server, port } = await listen(chatServer({
    registry: registryFor(new FakeReasoningStrategy()),
    conversationStore: store,
    summarizer: createFakeHistorySummarizer({ error: new Error("model unavailable") }).summarizer,
  }));
  context.after(() => close(server));

  const payload = await chatOn(port, conversationId, "What is pending?");
  assert.equal(payload.trace[0]?.type, "summarize");
  assert.equal(payload.trace[0]?.status, "failed");
  assert.ok(payload.answer.startsWith("Answer: "));
  assert.equal(payload.metrics.contextBreakdown.summary, 0);
});

test("POST /chat passes the same built context to a reflection-wrapped strategy", async (context) => {
  const store = new SqliteConversationStore(":memory:");
  context.after(() => store.close());
  const base = new FakeReasoningStrategy();
  const reflected = withReflection(base, {
    maxReflection: 0,
    critic: async (_input, onModelCall) => {
      onModelCall();
      return { approved: true, feedback: "ok" };
    },
  });
  const { server, port } = await listen(chatServer({
    registry: { resolve: () => reflected },
    conversationStore: store,
  }));
  context.after(() => close(server));

  await postChat(port, { message: "Status do plantão?" });
  assert.equal(base.inputs[0], bare("Status do plantão?"));
});

test("POST /chat reports per-section context budget and enforces the history ceiling", async (context) => {
  const store = new SqliteConversationStore(":memory:");
  context.after(() => store.close());
  const conversationId = await seededConversation(store, 8);
  const strategy = new FakeReasoningStrategy();
  const { server, port } = await listen(chatServer({
    registry: registryFor(strategy),
    conversationStore: store,
    summarizer: createFakeHistorySummarizer().summarizer,
    contextBudget: { system: 400, summary: 200, history: 40, memories: 300 },
  }));
  context.after(() => close(server));

  const response = await fetch(`http://127.0.0.1:${port}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "O que está pendente?", conversationId }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json() as {
    metrics: {
      contextBreakdown: { history: number };
      contextBudget: Record<"system" | "summary" | "history" | "memories", {
        budget: number; cut: string; keptTokens: number; droppedItems: number; overBudget: boolean;
      }>;
    };
  };
  const report = payload.metrics.contextBudget;
  assert.deepEqual(Object.keys(report).sort(), ["history", "memories", "summary", "system"]);
  assert.equal(report.history.budget, 40);
  assert.equal(report.history.cut, "oldest-first");
  assert.ok(report.history.droppedItems > 0);
  assert.ok(report.history.keptTokens <= 40);
  assert.ok(payload.metrics.contextBreakdown.history <= 40);
  assert.ok(strategy.inputs[0]?.includes("User: Question 7") || report.history.keptTokens === 0);
  assert.doesNotMatch(strategy.inputs[0] ?? "", /User: Question 4\b/);
});

test("createChatServer refuses an invalid context budget from the environment", (context) => {
  const previous = process.env.CONTEXT_BUDGET_MEMORIES;
  process.env.CONTEXT_BUDGET_MEMORIES = "x";
  context.after(() => {
    if (previous === undefined) delete process.env.CONTEXT_BUDGET_MEMORIES;
    else process.env.CONTEXT_BUDGET_MEMORIES = previous;
  });
  const store = new SqliteConversationStore(":memory:");
  context.after(() => store.close());
  assert.throws(
    () => chatServer({ registry: registryFor(new FakeReasoningStrategy()), conversationStore: store }),
    /CONTEXT_BUDGET_MEMORIES must be a non-negative integer/,
  );
});

function routingRegistry() {
  const strategies = {
    react: new FakeReasoningStrategy(),
    "plan-and-execute": new FakeReasoningStrategy(),
    reflection: new FakeReasoningStrategy(),
  };
  const registry: StrategyRegistry = {
    resolve(name, reflect = false) {
      if (reflect) return strategies.reflection;
      if (name === "react" || name === "plan-and-execute") return strategies[name];
      throw new Error(`Unexpected strategy: ${name}`);
    },
  };
  return { strategies, registry };
}

type RoutePayload = { trace: Array<{ type: string; node?: string; route?: string; source?: string }> };

async function routedChat(port: number, body: Record<string, unknown>): Promise<RoutePayload> {
  const response = await fetch(`http://127.0.0.1:${port}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 200);
  return await response.json() as RoutePayload;
}

test("POST /chat uses the requested strategy as an override without consulting the router", async (context) => {
  const store = new SqliteConversationStore(":memory:");
  context.after(() => store.close());
  const { strategies, registry } = routingRegistry();
  const fake = createFakeRouter("react");
  const { server, port } = await listen(createChatServer({ registry, conversationStore: store, router: fake.router, requestStore: new SqliteRequestStore(":memory:") }));
  context.after(() => close(server));

  const payload = await routedChat(port, { message: "Planeje a triagem", strategy: "plan-and-execute" });
  assert.equal(fake.calls.length, 0);
  assert.equal(strategies["plan-and-execute"].inputs.length, 1);
  const route = payload.trace.find((event) => event.type === "route");
  assert.equal(route?.source, "override");
  assert.equal(route?.route, "plan-and-execute");
});

test("POST /chat maps the legacy reflect flag to the reflection route", async (context) => {
  const store = new SqliteConversationStore(":memory:");
  context.after(() => store.close());
  const { strategies, registry } = routingRegistry();
  const fake = createFakeRouter("react");
  const { server, port } = await listen(createChatServer({ registry, conversationStore: store, router: fake.router, requestStore: new SqliteRequestStore(":memory:") }));
  context.after(() => close(server));

  const payload = await routedChat(port, { message: "Revise a decisão", reflect: true });
  assert.equal(fake.calls.length, 0);
  assert.equal(strategies.reflection.inputs.length, 1);
  assert.equal(payload.trace.find((event) => event.type === "route")?.route, "reflection");
});

test("POST /chat without a strategy consults the router once", async (context) => {
  const store = new SqliteConversationStore(":memory:");
  context.after(() => store.close());
  const { strategies, registry } = routingRegistry();
  const fake = createFakeRouter("plan-and-execute");
  const { server, port } = await listen(createChatServer({ registry, conversationStore: store, router: fake.router, requestStore: new SqliteRequestStore(":memory:") }));
  context.after(() => close(server));

  const payload = await routedChat(port, { message: "Abra incidentes para checkout e payments" });
  assert.equal(fake.calls.length, 1);
  assert.equal(strategies["plan-and-execute"].inputs.length, 1);
  assert.equal(strategies.react.inputs.length, 0);
  assert.equal(payload.trace.find((event) => event.type === "route")?.source, "router");
});

test("POST /chat names the graph node on every trace event for routed, override and fallback turns", async (context) => {
  const store = new SqliteConversationStore(":memory:");
  context.after(() => store.close());
  captureLogs(context);
  const nodes = new Set(["context", "router", "react", "plan-and-execute", "reflection", "response"]);
  for (const [router, body] of [
    [createFakeRouter("reflection").router, { message: "Qual a causa raiz?" }],
    [createFakeRouter("react").router, { message: "Status?", strategy: "plan-and-execute" }],
    [createFakeRouter(() => new Error("router down")).router, { message: "Status?" }],
  ] as const) {
    const { registry } = routingRegistry();
    const { server, port } = await listen(createChatServer({ registry, conversationStore: store, router, requestStore: new SqliteRequestStore(":memory:") }));
    try {
      const payload = await routedChat(port, body);
      assert.ok(payload.trace.length >= 2);
      assert.ok(payload.trace.every((event) => event.node !== undefined && nodes.has(event.node)));
    } finally {
      await close(server);
    }
  }
});

async function postChatRaw(port: number, body: Record<string, unknown>) {
  const response = await fetch(`http://127.0.0.1:${port}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, payload: await response.json() as Record<string, unknown> };
}

test("POST /chat reports the primary as modelUsed when no call switched", async (context) => {
  const store = new SqliteConversationStore(":memory:");
  context.after(() => store.close());
  const { server, port } = await listen(chatServer({ registry: registryFor(new FakeReasoningStrategy()), conversationStore: store }));
  context.after(() => close(server));

  const { status, payload } = await postChatRaw(port, { message: "Status?" });
  assert.equal(status, 200);
  assert.equal((payload.metrics as { modelUsed: string }).modelUsed, "fake/primary");
  assert.equal((payload.trace as Array<{ type: string }>).some(({ type }) => type === "fallback"), false);
});

test("POST /chat reports the reserve as modelUsed with a tagged fallback event", async (context) => {
  captureLogs(context);
  const store = new SqliteConversationStore(":memory:");
  context.after(() => store.close());
  const strategy = new FakeReasoningStrategy((input) => {
    reportModelFallback({ primaryModel: "fake/primary", reserveModel: "fake/reserve", reason: "boom" });
    return { answer: `Answer: ${input}`, trace: [{ type: "answer", content: "ok" }], metrics: { llmCalls: 1, latencyMs: 1 } };
  });
  const { server, port } = await listen(chatServer({ registry: registryFor(strategy), conversationStore: store }));
  context.after(() => close(server));

  const { status, payload } = await postChatRaw(port, { message: "Status?" });
  assert.equal(status, 200);
  assert.equal((payload.metrics as { modelUsed: string }).modelUsed, "fake/reserve");
  const fallback = (payload.trace as Array<Record<string, unknown>>).find(({ type }) => type === "fallback");
  assert.deepEqual(fallback, {
    type: "fallback",
    node: "react",
    primaryModel: "fake/primary",
    reserveModel: "fake/reserve",
    reason: "boom",
    content: "Model fallback fake/primary → fake/reserve: boom",
  });
});

test("POST /chat returns 503 when no model can answer and persists nothing", async (context) => {
  captureLogs(context);
  const store = new SqliteConversationStore(":memory:");
  context.after(() => store.close());
  const conversationId = store.create().id;
  const down = new FakeReasoningStrategy(() => {
    throw new ModelUnavailableError("Language models are unavailable; try again later.");
  });
  const { server, port } = await listen(chatServer({ registry: registryFor(down), conversationStore: store }));
  context.after(() => close(server));

  const { status, payload } = await postChatRaw(port, { message: "Status?", conversationId });
  assert.equal(status, 503);
  assert.deepEqual({ ...payload, requestId: undefined }, { error: "Language models are unavailable; try again later.", requestId: undefined });
  assert.match(String(payload.requestId), UUID);
  assert.equal(store.lastMessages(conversationId, 12).length, 0);
});

test("POST /chat returns 503 when a strategy and its ReAct fallback both lose the models", async (context) => {
  captureLogs(context);
  const store = new SqliteConversationStore(":memory:");
  context.after(() => store.close());
  const down = new FakeReasoningStrategy(() => {
    throw new ModelUnavailableError("Language models are unavailable; try again later.");
  });
  const registry: StrategyRegistry = { resolve: () => down };
  const { server, port } = await listen(chatServer({ registry, conversationStore: store }));
  context.after(() => close(server));

  const { status } = await postChatRaw(port, { message: "Planeje", strategy: "plan-and-execute" });
  assert.equal(status, 503);
});

// --- Feature 015: request ids ---------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function rawChat(port: number, body: string, headers: Record<string, string> = {}) {
  const response = await fetch(`http://127.0.0.1:${port}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  });
  return {
    status: response.status,
    header: response.headers.get("x-request-id"),
    payload: await response.json() as Record<string, unknown>,
  };
}

test("a successful chat carries the same request id in header and body", async (context) => {
  const store = new SqliteConversationStore(":memory:");
  context.after(() => store.close());
  const { server, port } = await listen(chatServer({ registry: registryFor(new FakeReasoningStrategy()), conversationStore: store }));
  context.after(() => close(server));

  const { status, header, payload } = await rawChat(port, JSON.stringify({ message: "Status?" }));
  assert.equal(status, 200);
  assert.match(header ?? "", UUID);
  assert.equal(payload.requestId, header);
});

test("every error status carries the request id in header and body", async (context) => {
  captureLogs(context);
  const store = new SqliteConversationStore(":memory:");
  context.after(() => store.close());
  const throwing = (error: Error) => registryFor(new FakeReasoningStrategy(() => { throw error; }));
  const slow = registryFor(new FakeReasoningStrategy(async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    return { answer: "late", trace: [{ type: "answer", content: "late" }], metrics: { llmCalls: 1, latencyMs: 1 } };
  }));
  const cases: Array<{ name: string; options: Parameters<typeof chatServer>[0]; body: string; status: number }> = [
    { name: "schema", options: {}, body: JSON.stringify({}), status: 400 },
    { name: "malformed JSON", options: {}, body: "{", status: 400 },
    { name: "unknown conversation", options: {}, body: JSON.stringify({ message: "x", conversationId: "00000000-0000-4000-8000-000000000000" }), status: 404 },
    { name: "unknown strategy", options: {}, body: JSON.stringify({ message: "x", strategy: "nope" }), status: 422 },
    { name: "models down", options: { registry: throwing(new ModelUnavailableError("Language models are unavailable; try again later.")) }, body: JSON.stringify({ message: "x" }), status: 503 },
    { name: "timeout", options: { registry: slow, timeoutMs: 10 }, body: JSON.stringify({ message: "x" }), status: 504 },
    { name: "internal", options: { registry: throwing(new Error("boom")) }, body: JSON.stringify({ message: "x" }), status: 500 },
  ];
  for (const { name, options, body, status } of cases) {
    const { server, port } = await listen(chatServer({ registry: registryFor(new FakeReasoningStrategy()), conversationStore: store, ...options }));
    const result = await rawChat(port, body);
    await close(server);
    assert.equal(result.status, status, name);
    assert.match(result.header ?? "", UUID, name);
    assert.equal(result.payload.requestId, result.header, name);
    assert.equal(typeof result.payload.error, "string", name);
  }
});

test("a client X-Request-Id is ignored and ids never repeat", async (context) => {
  const store = new SqliteConversationStore(":memory:");
  context.after(() => store.close());
  const { server, port } = await listen(chatServer({ registry: registryFor(new FakeReasoningStrategy()), conversationStore: store }));
  context.after(() => close(server));

  const spoofed = await rawChat(port, JSON.stringify({ message: "x" }), { "X-Request-Id": "client-id" });
  assert.notEqual(spoofed.header, "client-id");
  assert.match(spoofed.header ?? "", UUID);

  const ids = new Set<string>();
  for (let index = 0; index < 100; index += 1) {
    ids.add((await rawChat(port, JSON.stringify({})) ).header ?? "");
  }
  assert.equal(ids.size, 100);
});

// --- Feature 015: persisted record + GET /requests/:id ----------------------------------

async function lookup(port: number, id: string) {
  const response = await fetch(`http://127.0.0.1:${port}/requests/${id}`);
  return { status: response.status, payload: await response.json() as Record<string, any> };
}

test("GET /requests/:id returns the record and the same ordered trace as the chat response", async (context) => {
  const store = new SqliteConversationStore(":memory:");
  context.after(() => store.close());
  const requestStore = new SqliteRequestStore(":memory:");
  context.after(() => requestStore.close());
  const strategy = new FakeReasoningStrategy((input) => ({
    answer: `Answer: ${input}`,
    trace: [{ type: "thought", content: "pensando" }, { type: "answer", content: "ok" }],
    metrics: { llmCalls: 1, latencyMs: 7, promptTokens: 30 },
  }));
  const { server, port } = await listen(chatServer({ registry: registryFor(strategy), conversationStore: store, requestStore }));
  context.after(() => close(server));

  const chat = await rawChat(port, JSON.stringify({ message: "Status?", userId: undefined }));
  assert.equal(chat.status, 200);
  const { status, payload } = await lookup(port, String(chat.payload.requestId));
  assert.equal(status, 200);
  const metrics = chat.payload.metrics as Record<string, unknown>;
  assert.equal(payload.request.id, chat.payload.requestId);
  assert.equal(payload.request.status, 200);
  assert.equal(payload.request.errorCategory, null);
  assert.equal(payload.request.conversationId, chat.payload.conversationId);
  assert.equal(payload.request.route, "react");
  assert.equal(payload.request.requestedRoute, null);
  assert.deepEqual(payload.request.metrics, {
    llmCalls: metrics.llmCalls,
    latencyMs: metrics.latencyMs,
    promptTokens: metrics.promptTokens,
    historyMessages: metrics.historyMessages,
    modelUsed: metrics.modelUsed,
  });
  assert.deepEqual(payload.trace, chat.payload.trace);
});

test("failed turns are recorded with status, category and the partial trace", async (context) => {
  captureLogs(context);
  const store = new SqliteConversationStore(":memory:");
  context.after(() => store.close());
  const conversationId = store.create().id;
  const requestStore = new SqliteRequestStore(":memory:");
  context.after(() => requestStore.close());
  const down = registryFor(new FakeReasoningStrategy(() => {
    throw new ModelUnavailableError("Language models are unavailable; try again later.");
  }));
  const { server, port } = await listen(chatServer({ registry: down, conversationStore: store, requestStore }));
  context.after(() => close(server));

  const failed = await rawChat(port, JSON.stringify({ message: "Status?", conversationId, strategy: "react" }));
  assert.equal(failed.status, 503);
  const record = await lookup(port, String(failed.payload.requestId));
  assert.equal(record.payload.request.status, 503);
  assert.equal(record.payload.request.errorCategory, "model_unavailable");
  assert.equal(record.payload.request.metrics, null);
  assert.equal(record.payload.request.conversationId, conversationId);
  assert.equal(record.payload.request.requestedRoute, "react");
  assert.deepEqual(record.payload.trace.map((event: { type: string; node: string }) => `${event.type}:${event.node}`), ["route:router"]);

  const invalid = await rawChat(port, JSON.stringify({}));
  const invalidRecord = await lookup(port, String(invalid.payload.requestId));
  assert.equal(invalidRecord.payload.request.status, 400);
  assert.equal(invalidRecord.payload.request.errorCategory, "invalid_request");
  assert.deepEqual(invalidRecord.payload.trace, []);

  const malformed = await rawChat(port, "{");
  assert.equal((await lookup(port, String(malformed.payload.requestId))).payload.request.status, 400);
});

test("GET /requests/:id rejects malformed ids and reports unknown ones", async (context) => {
  const { server, port } = await listen(chatServer());
  context.after(() => close(server));
  assert.deepEqual(await lookup(port, "not-a-uuid"), { status: 400, payload: { error: "Invalid request id" } });
  const unknown = "00000000-0000-4000-8000-000000000000";
  assert.deepEqual(await lookup(port, unknown), { status: 404, payload: { error: `Unknown request: ${unknown}` } });
});

test("a failing request store never changes the chat response", async (context) => {
  const store = new SqliteConversationStore(":memory:");
  context.after(() => store.close());
  const broken: RequestStore = {
    record() { throw new Error("database is locked"); },
    get() { return undefined; },
    listSince() { return []; },
    close() {},
  };
  const { server, port } = await listen(chatServer({ registry: registryFor(new FakeReasoningStrategy()), conversationStore: store, requestStore: broken }));
  context.after(() => close(server));
  const chat = await rawChat(port, JSON.stringify({ message: "Status?" }));
  assert.equal(chat.status, 200);
  assert.match(String(chat.payload.requestId), UUID);
});

// --- Feature 015: JSON logs ---------------------------------------------------------------

test("one metadata-only JSON line per event for a successful turn", async (context) => {
  const logs = captureLogs(context);
  const store = new SqliteConversationStore(":memory:");
  context.after(() => store.close());
  const strategy = new FakeReasoningStrategy(() => ({
    answer: "Resposta secreta",
    trace: [{ type: "thought", content: "pensamento privado" }, { type: "answer", content: "Resposta secreta" }],
    metrics: { llmCalls: 1, latencyMs: 3, promptTokens: 20 },
  }));
  const { server, port } = await listen(chatServer({ registry: registryFor(strategy), conversationStore: store }));
  context.after(() => close(server));

  const chat = await rawChat(port, JSON.stringify({ message: "Mensagem do usuario" }));
  const requestId = chat.payload.requestId;
  const mine = logs.events().filter((line) => line.requestId === requestId);
  const trace = chat.payload.trace as Array<{ type: string; node: string }>;
  assert.deepEqual(mine.map(({ event }) => event), [
    "request_started",
    ...trace.map(() => "trace_event"),
    "request_finished",
  ]);
  assert.deepEqual(
    mine.filter(({ event }) => event === "trace_event").map(({ seq, type, node }) => ({ seq, type, node })),
    trace.map(({ type, node }, seq) => ({ seq, type, node })),
  );
  const finished = mine.at(-1);
  assert.equal(finished?.level, "info");
  assert.equal(finished?.status, 200);
  assert.equal(finished?.traceEvents, trace.length);
  assert.equal(finished?.llmCalls, 2);
  assert.equal(finished?.promptTokens, (chat.payload.metrics as { promptTokens: number | null }).promptTokens);
  assert.equal(finished?.modelUsed, "fake/primary");
  assert.equal(finished?.route, "react");
  assert.equal(typeof finished?.durationMs, "number");
  for (const line of logs.lines) {
    assert.doesNotMatch(line, /Mensagem do usuario|Resposta secreta|pensamento privado/);
    const keys = Object.keys(JSON.parse(line));
    for (const forbidden of ["content", "reason", "answer", "args", "message", "userId"]) {
      assert.ok(!keys.includes(forbidden), `${forbidden} must never be logged`);
    }
  }
});

test("failed turns log their level, status and category; storage failures are logged", async (context) => {
  const logs = captureLogs(context);
  const store = new SqliteConversationStore(":memory:");
  context.after(() => store.close());
  const down = registryFor(new FakeReasoningStrategy(() => {
    throw new ModelUnavailableError("Language models are unavailable; try again later.");
  }));
  const { server, port } = await listen(chatServer({ registry: down, conversationStore: store }));
  context.after(() => close(server));

  const failed = await rawChat(port, JSON.stringify({ message: "x" }));
  const finished503 = logs.named("request_finished").find((line) => line.requestId === failed.payload.requestId);
  assert.deepEqual(
    { level: finished503?.level, status: finished503?.status, errorCategory: finished503?.errorCategory },
    { level: "error", status: 503, errorCategory: "model_unavailable" },
  );

  const missing = await rawChat(port, JSON.stringify({ message: "x", conversationId: "00000000-0000-4000-8000-000000000000" }));
  const finished404 = logs.named("request_finished").find((line) => line.requestId === missing.payload.requestId);
  assert.equal(finished404?.level, "warn");
  assert.equal(finished404?.status, 404);

  const broken: RequestStore = { record() { throw new Error("locked"); }, get() { return undefined; }, listSince() { return []; }, close() {} };
  const { server: other, port: otherPort } = await listen(chatServer({ registry: registryFor(new FakeReasoningStrategy()), conversationStore: store, requestStore: broken }));
  const ok = await rawChat(otherPort, JSON.stringify({ message: "x" }));
  await close(other);
  const persistence = logs.named("persistence_failed").find((line) => line.requestId === ok.payload.requestId);
  assert.equal(persistence?.level, "error");
  assert.equal(persistence?.errorCategory, "persistence");
});

// --- GET /stats ---------------------------------------------------------------------------

test("GET /stats aggregates the requests of the window", async (context) => {
  const requestStore = new SqliteRequestStore(":memory:");
  context.after(() => requestStore.close());
  const { buildRequestRecord } = await import("../../src/store/request-store.ts");
  const at = (iso: string, ms: number) => ({ startedAt: new Date(iso), finishedAt: new Date(new Date(iso).getTime() + ms) });
  const base = { conversationId: null, userId: null, requestedRoute: null };
  const routeTrace = [{ type: "route" as const, node: "router" as const, content: "r", route: "react" as const, reason: "x", source: "router" as const }];
  requestStore.record(buildRequestRecord({
    ...base, id: "00000000-0000-4000-8000-000000000001", ...at("2026-10-24T11:00:00.000Z", 100), status: 200, errorCategory: null,
    trace: routeTrace, metrics: { llmCalls: 2, latencyMs: 90, promptTokens: 2_000_000, historyMessages: 0, modelUsed: "openai/gpt-4o-mini" },
  }), routeTrace);
  requestStore.record(buildRequestRecord({
    ...base, id: "00000000-0000-4000-8000-000000000002", ...at("2026-10-24T11:30:00.000Z", 300), status: 200, errorCategory: null,
    trace: routeTrace, metrics: { llmCalls: 1, latencyMs: 290, promptTokens: 500, historyMessages: 0, modelUsed: "meta/llama:free" },
  }), routeTrace);
  requestStore.record(buildRequestRecord({
    ...base, id: "00000000-0000-4000-8000-000000000003", ...at("2026-10-24T11:45:00.000Z", 20), status: 503,
    errorCategory: "model_unavailable", trace: [], metrics: null,
  }), []);
  // Outside a 1h window:
  requestStore.record(buildRequestRecord({
    ...base, id: "00000000-0000-4000-8000-000000000004", ...at("2026-10-23T08:00:00.000Z", 999), status: 200, errorCategory: null,
    trace: [], metrics: { llmCalls: 1, latencyMs: 1, promptTokens: 1, historyMessages: 0, modelUsed: "openrouter/free" },
  }), []);

  const { server, port } = await listen(chatServer({
    requestStore,
    modelPrices: { "openai/gpt-4o-mini": 0.15 },
    now: () => new Date("2026-10-24T12:00:00.000Z"),
  }));
  context.after(() => close(server));

  const response = await fetch(`http://127.0.0.1:${port}/stats?since=1h`);
  assert.equal(response.status, 200);
  const stats = await response.json() as Record<string, any>;
  assert.equal(stats.since, "1h");
  assert.equal(stats.from, "2026-10-24T11:00:00.000Z");
  assert.equal(stats.to, "2026-10-24T12:00:00.000Z");
  assert.equal(stats.total, 3);
  assert.equal(stats.errors, 1);
  assert.equal(stats.promptTokens, 2_000_500);
  assert.equal(stats.costUsd, 0.3);
  assert.deepEqual(stats.latencyMs, { p50: 100, p95: 300 });
  assert.deepEqual(Object.keys(stats.byRoute).sort(), ["none", "react"]);
  assert.equal(stats.byRoute.react.total, 2);
  assert.equal(stats.byModel["meta/llama:free"].costUsd, 0);
  assert.equal(stats.byModel.unknown.errors, 1);

  const day = await (await fetch(`http://127.0.0.1:${port}/stats`)).json() as Record<string, any>;
  assert.equal(day.since, "24h");
  assert.equal(day.total, 3);
  assert.equal((await (await fetch(`http://127.0.0.1:${port}/stats?since=30h`)).json() as Record<string, any>).total, 4);
});

test("GET /stats rejects a malformed window", async (context) => {
  const { server, port } = await listen(chatServer());
  context.after(() => close(server));
  for (const since of ["abc", "0h", "1w", "999d"]) {
    const response = await fetch(`http://127.0.0.1:${port}/stats?since=${since}`);
    assert.equal(response.status, 400, since);
    assert.match((await response.json() as { error: string }).error, /since must look like/);
  }
});

// --- CORS ---------------------------------------------------------------------------------

test("CORS preflight from an allowed origin returns 204 with the allow headers", async (context) => {
  const { server, port } = await listen(chatServer({ corsOrigins: ["http://localhost:5173"] }));
  context.after(() => close(server));
  const response = await fetch(`http://127.0.0.1:${port}/chat`, {
    method: "OPTIONS",
    headers: { "Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), "http://localhost:5173");
  assert.equal(response.headers.get("access-control-allow-methods"), "GET, POST, OPTIONS");
  assert.equal(response.headers.get("access-control-allow-headers"), "Content-Type");
  assert.equal(response.headers.get("access-control-max-age"), "600");
});

test("CORS: allowed origins see X-Request-Id; others and no-origin calls get no CORS headers", async (context) => {
  const { server, port } = await listen(chatServer({ corsOrigins: ["http://localhost:5173"] }));
  context.after(() => close(server));
  const allowed = await fetch(`http://127.0.0.1:${port}/chat`, {
    method: "POST",
    headers: { "Origin": "http://localhost:5173", "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(allowed.status, 400);
  assert.equal(allowed.headers.get("access-control-allow-origin"), "http://localhost:5173");
  assert.equal(allowed.headers.get("access-control-expose-headers"), "X-Request-Id");
  assert.ok(allowed.headers.get("x-request-id"));

  const evil = await fetch(`http://127.0.0.1:${port}/stats`, { headers: { Origin: "http://evil.example" } });
  assert.equal(evil.status, 200);
  assert.equal([...evil.headers.keys()].filter((key) => key.startsWith("access-control-")).length, 0);

  const plain = await fetch(`http://127.0.0.1:${port}/stats`);
  assert.equal(plain.status, 200);
  assert.equal(plain.headers.get("access-control-allow-origin"), null);
});

test("CORS uses OPSPILOT_CORS_ORIGINS when no option is given", async (context) => {
  const previous = process.env.OPSPILOT_CORS_ORIGINS;
  process.env.OPSPILOT_CORS_ORIGINS = "http://war.test:8080";
  context.after(() => {
    if (previous === undefined) delete process.env.OPSPILOT_CORS_ORIGINS;
    else process.env.OPSPILOT_CORS_ORIGINS = previous;
  });
  const { server, port } = await listen(chatServer());
  context.after(() => close(server));
  const ok = await fetch(`http://127.0.0.1:${port}/stats`, { headers: { Origin: "http://war.test:8080" } });
  assert.equal(ok.headers.get("access-control-allow-origin"), "http://war.test:8080");
  const dev = await fetch(`http://127.0.0.1:${port}/stats`, { headers: { Origin: "http://localhost:5173" } });
  assert.equal(dev.headers.get("access-control-allow-origin"), null);
});

// --- Approval (202) -------------------------------------------------------------------------

async function approvalHarness(context: { after: (fn: () => unknown) => void }) {
  const { SqliteOpsStore } = await import("../../src/store/sqlite-ops-store.ts");
  const { OpsService } = await import("../../src/domain/ops-service.ts");
  const { createResolveIncidentTool } = await import("../../src/tools/resolve-incident.ts");
  const { createOpenIncidentTool } = await import("../../src/tools/open-incident.ts");
  const opsStore = new SqliteOpsStore(":memory:");
  const conversationStore = new SqliteConversationStore(":memory:");
  const requestStore = new SqliteRequestStore(":memory:");
  const approvalStore = new SqliteApprovalStore(":memory:");
  context.after(() => {
    opsStore.close();
    conversationStore.close();
    requestStore.close();
    approvalStore.close();
  });
  const service = new OpsService(opsStore);
  const incident = service.openIncident({ title: "Checkout failing", service: "checkout", severity: "high" });
  const resolveTool = createResolveIncidentTool(service);
  const openTool = createOpenIncidentTool(service);
  const strategy = new FakeReasoningStrategy(async (input) => {
    if (input.includes("Resolva")) {
      await resolveTool.invoke({ id: incident.id });
      return { answer: "resolved without approval", trace: [], metrics: { llmCalls: 1, latencyMs: 1 } };
    }
    if (input.includes("Abra")) {
      await openTool.invoke({ title: "Payments slow", service: "payments", severity: "low" });
      return { answer: "Incidente aberto.", trace: [{ type: "answer", content: "Incidente aberto." }], metrics: { llmCalls: 1, latencyMs: 1 } };
    }
    return { answer: "Dois alertas.", trace: [{ type: "answer", content: "Dois alertas." }], metrics: { llmCalls: 1, latencyMs: 1 } };
  });
  const executed: string[] = [];
  let clock = new Date("2026-10-24T13:05:00.000Z");
  const app = chatServer({
    registry: registryFor(strategy),
    conversationStore,
    requestStore,
    approvalStore,
    timeoutMs: 2000,
    now: () => clock,
    resolveIncident: (id) => {
      executed.push(id);
      return service.resolveIncident(id);
    },
  });
  const { server, port } = await listen(app);
  context.after(() => close(server));
  const base = `http://127.0.0.1:${port}`;
  const post = (path: string, body: unknown) => fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    base,
    post,
    service,
    incident,
    executed,
    requestStore,
    conversationStore,
    advance: (minutes: number) => {
      clock = new Date(clock.getTime() + minutes * 60_000);
    },
  };
}

type PendingBody = {
  status: string;
  requestId: string;
  conversationId: string;
  approval: { id: string; status: string; tool: string; target: string; args: { id: string }; expiresAt: string };
  trace: Array<{ type: string; node: string; decision?: string }>;
  metrics: { llmCalls: number; modelUsed: string };
};

test("POST /chat answers 202 before resolve_incident and nothing runs", async (context) => {
  const h = await approvalHarness(context);
  const response = await h.post("/chat", { message: `Resolva o incidente ${h.incident.id}` });
  assert.equal(response.status, 202);
  const body = await response.json() as PendingBody;
  assert.equal(body.status, "pending_approval");
  assert.equal(response.headers.get("x-request-id"), body.requestId);
  assert.equal(body.approval.status, "pending");
  assert.equal(body.approval.tool, "resolve_incident");
  assert.equal(body.approval.target, h.incident.id);
  assert.equal(body.approval.expiresAt, "2026-10-24T13:20:00.000Z");
  assert.deepEqual(body.trace.map(({ type, node }) => `${type}:${node}`), ["route:router", "approval:react"]);
  assert.equal(body.trace.at(-1)?.decision, "pending");
  assert.equal(body.metrics.modelUsed, "fake/primary");
  assert.deepEqual(h.executed, []);
  assert.equal(h.service.listIncidents("open").some(({ id }) => id === h.incident.id), true);

  const stored = h.requestStore.get(body.requestId);
  assert.equal(stored?.record.status, 202);
  assert.equal(stored?.record.errorCategory, null);
  assert.deepEqual(h.conversationStore.lastMessages(body.conversationId, 10).map(({ role, content }) => [role, content]), [
    ["user", `Resolva o incidente ${h.incident.id}`],
    ["assistant", `Aguardando aprovação do operador: Resolver o incidente ${h.incident.id}.`],
  ]);

  const lookup = await fetch(`${h.base}/approvals/${body.approval.id}`);
  assert.equal(lookup.status, 200);
  assert.equal((await lookup.json() as { approval: { status: string } }).approval.status, "pending");
  assert.equal((await fetch(`${h.base}/approvals/not-a-uuid`)).status, 400);
  assert.equal((await fetch(`${h.base}/approvals/0b9a4c21-7e55-4d2f-8a61-3c0f9e7b2d44`)).status, 404);
  h.advance(15);
  const later = await (await fetch(`${h.base}/approvals/${body.approval.id}`)).json() as { approval: { status: string } };
  assert.equal(later.approval.status, "expired");
});

test("approve runs the resolution once and finishes the turn; a second decision is 409", async (context) => {
  const h = await approvalHarness(context);
  const pending = await (await h.post("/chat", { message: `Resolva o incidente ${h.incident.id}` })).json() as PendingBody;

  const decided = await h.post(`/approvals/${pending.approval.id}/decision`, { decision: "approve" });
  assert.equal(decided.status, 200);
  const body = await decided.json() as {
    approval: { status: string; decidedAt: string | null };
    answer: string;
    trace: Array<{ type: string; node: string }>;
    conversationId: string;
    requestId: string;
    metrics: { llmCalls: number };
  };
  assert.equal(decided.headers.get("x-request-id"), body.requestId);
  assert.notEqual(body.requestId, pending.requestId);
  assert.equal(body.approval.status, "approved");
  assert.ok(body.approval.decidedAt);
  assert.equal(body.answer, `Incidente ${h.incident.id} resolvido após aprovação do operador.`);
  assert.deepEqual(body.trace.map(({ type, node }) => `${type}:${node}`), ["approval:response", "action:response", "observation:response", "answer:response"]);
  assert.equal(body.metrics.llmCalls, 0);
  assert.deepEqual(h.executed, [h.incident.id]);
  assert.equal(h.service.listIncidents("open").some(({ id }) => id === h.incident.id), false);
  assert.equal(h.requestStore.get(body.requestId)?.record.status, 200);
  assert.equal(h.conversationStore.lastMessages(pending.conversationId, 10).at(-1)?.content, body.answer);

  const again = await h.post(`/approvals/${pending.approval.id}/decision`, { decision: "deny" });
  assert.equal(again.status, 409);
  const refused = await again.json() as { error: string; approval: { status: string } };
  assert.equal(refused.error, "Approval is no longer pending");
  assert.equal(refused.approval.status, "approved");
  assert.deepEqual(h.executed, [h.incident.id], "never runs twice");
});

test("deny never runs the resolution and the incident stays open", async (context) => {
  const h = await approvalHarness(context);
  const pending = await (await h.post("/chat", { message: `Resolva o incidente ${h.incident.id}` })).json() as PendingBody;
  const denied = await h.post(`/approvals/${pending.approval.id}/decision`, { decision: "deny" });
  assert.equal(denied.status, 200);
  const body = await denied.json() as { answer: string; approval: { status: string }; trace: Array<{ type: string }> };
  assert.equal(body.approval.status, "denied");
  assert.equal(body.answer, `Resolução do incidente ${h.incident.id} negada pelo operador; nada foi alterado.`);
  assert.deepEqual(body.trace.map(({ type }) => type), ["approval", "answer"]);
  assert.deepEqual(h.executed, []);
  assert.equal(h.service.listIncidents("open").some(({ id }) => id === h.incident.id), true);
});

test("decision validation: bad body 400, unknown 404, expired 409", async (context) => {
  const h = await approvalHarness(context);
  const pending = await (await h.post("/chat", { message: `Resolva o incidente ${h.incident.id}` })).json() as PendingBody;
  assert.equal((await h.post(`/approvals/${pending.approval.id}/decision`, { decision: "maybe" })).status, 400);
  assert.equal((await h.post("/approvals/not-a-uuid/decision", { decision: "approve" })).status, 400);
  assert.equal((await h.post("/approvals/0b9a4c21-7e55-4d2f-8a61-3c0f9e7b2d44/decision", { decision: "approve" })).status, 404);
  h.advance(16);
  const expired = await h.post(`/approvals/${pending.approval.id}/decision`, { decision: "approve" });
  assert.equal(expired.status, 409);
  assert.equal((await expired.json() as { approval: { status: string } }).approval.status, "expired");
  assert.deepEqual(h.executed, []);
});

test("read-only questions and opening an incident need no approval", async (context) => {
  const h = await approvalHarness(context);
  const read = await h.post("/chat", { message: "Quais alertas?" });
  assert.equal(read.status, 200);
  const open = await h.post("/chat", { message: "Abra um incidente de busca" });
  assert.equal(open.status, 200, JSON.stringify(await open.clone().json()));
  assert.equal((await open.json() as { answer: string }).answer, "Incidente aberto.");
  assert.equal(h.service.listIncidents("open").some(({ serviceId }) => serviceId === "payments"), true);
});

test("CORS from a configured preview origin covers the decision route", async (context) => {
  const { server, port } = await listen(chatServer({ corsOrigins: ["http://localhost:4173"] }));
  context.after(() => close(server));
  const preflight = await fetch(`http://127.0.0.1:${port}/approvals/0b9a4c21-7e55-4d2f-8a61-3c0f9e7b2d44/decision`, {
    method: "OPTIONS",
    headers: { "Origin": "http://localhost:4173", "Access-Control-Request-Method": "POST" },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "http://localhost:4173");
  const decision = await fetch(`http://127.0.0.1:${port}/approvals/0b9a4c21-7e55-4d2f-8a61-3c0f9e7b2d44/decision`, {
    method: "POST",
    headers: { "Origin": "http://localhost:4173", "Content-Type": "application/json" },
    body: JSON.stringify({ decision: "approve" }),
  });
  assert.equal(decision.status, 404);
  assert.equal(decision.headers.get("access-control-allow-origin"), "http://localhost:4173");
  assert.equal(decision.headers.get("access-control-expose-headers"), "X-Request-Id");
  const dev = await fetch(`http://127.0.0.1:${port}/stats`, { headers: { Origin: "http://localhost:5173" } });
  assert.equal(dev.headers.get("access-control-allow-origin"), null);
});
