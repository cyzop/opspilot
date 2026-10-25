import assert from "node:assert/strict";
import test from "node:test";
import { reflectUserLearning } from "../src/strategies/reflection.ts";
import { createForgetPreferenceTool } from "../src/tools/forget-preference.ts";
import type { Memory, MemoryRecallResult, MemoryStore } from "../src/memory/memory-store.ts";

function buildMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: overrides.id ?? "memory-1",
    userId: overrides.userId ?? "user-1",
    fact: overrides.fact ?? "I prefer critical alerts first.",
    embedding: overrides.embedding ?? new Float32Array(384).fill(0.1),
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
  };
}

test("reflectUserLearning stores only durable safe preferences for the current user", async () => {
  const calls: Array<[string, string]> = [];
  const store: MemoryStore = {
    async remember(userId: string, fact: string) {
      calls.push([userId, fact]);
      return { memory: buildMemory({ userId, fact }), inserted: true };
    },
    async recall() {
      return [] as MemoryRecallResult[];
    },
    forget() {
      return false;
    },
  };

  const result = await reflectUserLearning({
    userId: "user-1",
    message: "I prefer critical alerts first.",
    memoryStore: store,
    model: {
      withStructuredOutput: () => ({
        invoke: async () => ({ hasLearning: true, fact: " I prefer critical alerts first. " }),
      }),
    } as never,
  });

  assert.equal(result, true);
  assert.deepEqual(calls, [["user-1", "I prefer critical alerts first."]]);
});

test("reflectUserLearning rejects secrets and one-off requests", async () => {
  const calls: Array<[string, string]> = [];
  const store: MemoryStore = {
    async remember(userId: string, fact: string) {
      calls.push([userId, fact]);
      return { memory: buildMemory({ userId, fact }), inserted: true };
    },
    async recall() {
      return [] as MemoryRecallResult[];
    },
    forget() {
      return false;
    },
  };

  const secretResult = await reflectUserLearning({
    userId: "user-1",
    message: "My password is hunter2.",
    memoryStore: store,
    model: {
      withStructuredOutput: () => ({
        invoke: async () => ({ hasLearning: true, fact: "My password is hunter2." }),
      }),
    } as never,
  });
  assert.equal(secretResult, false);

  const transientResult = await reflectUserLearning({
    userId: "user-1",
    message: "Can you restart the payments service right now?",
    memoryStore: store,
    model: {
      withStructuredOutput: () => ({
        invoke: async () => ({ hasLearning: true, fact: "Restart the payments service right now." }),
      }),
    } as never,
  });

  assert.equal(transientResult, false);
  assert.deepEqual(calls, []);
});

test("forget_preference removes only the unique matching memory for the current user", async () => {
  const remembers: string[] = [];
  const store: MemoryStore = {
    async remember() {
      return { memory: buildMemory(), inserted: true };
    },
    async recall(userId: string, query: string) {
      assert.equal(userId, "user-1");
      assert.match(query, /critical alerts/i);
      return [{
        memory: buildMemory({ id: "memory-1", userId: "user-1", fact: "I prefer critical alerts first." }),
        score: 0.99,
      }];
    },
    forget(memoryId: string) {
      remembers.push(memoryId);
      return true;
    },
  };

  const forget = createForgetPreferenceTool(store);
  const result = JSON.parse(await forget.invoke({ userId: "user-1", preference: "I prefer critical alerts first." }) as string) as {
    deleted: boolean;
    message: string;
  };

  assert.equal(result.deleted, true);
  assert.match(result.message, /Forgot preference/i);
  assert.deepEqual(remembers, ["memory-1"]);
});
