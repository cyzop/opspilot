import assert from "node:assert/strict";
import test from "node:test";
import { isDuplicateSimilarity, SqliteMemoryStore } from "../../src/memory/memory-store.ts";
import { InvalidEmbeddingError, MemoryValidationError } from "../../src/domain/errors.ts";
import {
  createFakeEmbedder,
  normalizedVector,
  vectorWithFirstComponent,
} from "../helpers/fake-embedder.ts";

function createStore(vectors: Readonly<Record<string, Float32Array>>) {
  const fake = createFakeEmbedder(vectors);
  let nextId = 0;
  return {
    store: new SqliteMemoryStore(":memory:", {
      embed: fake.embed,
      createId: () => `memory-${String(++nextId).padStart(3, "0")}`,
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    }),
    fake,
  };
}

test("deduplication threshold is strictly greater than 0.92", () => {
  assert.equal(isDuplicateSimilarity(0.92), false);
  assert.equal(isDuplicateSimilarity(0.920001), true);
});

test("remember inserts, deduplicates only above 0.92, and isolates users", async (context) => {
  const { store } = createStore({
    original: normalizedVector({ 0: 1 }),
    duplicate: vectorWithFirstComponent(0.95),
    boundary: vectorWithFirstComponent(0.9199999),
    "other-user": normalizedVector({ 0: 1 }),
  });
  context.after(() => store.close());

  const original = await store.remember("user-a", "original");
  const duplicate = await store.remember("user-a", "duplicate");
  const boundary = await store.remember("user-a", "boundary");
  const separateUser = await store.remember("user-b", "other-user");

  assert.equal(original.inserted, true);
  assert.equal(duplicate.inserted, false);
  assert.equal(duplicate.memory.id, original.memory.id);
  assert.equal(boundary.inserted, true);
  assert.equal(separateUser.inserted, true);
  assert.equal(store._db.prepare("SELECT COUNT(*) AS count FROM memories").get()?.count, 3);
});

test("forget deletes only the matching user's memory and reports misses", async (context) => {
  const { store } = createStore({
    first: normalizedVector({ 0: 1 }),
    second: normalizedVector({ 1: 1 }),
  });
  context.after(() => store.close());
  const first = await store.remember("user-a", "first");
  await store.remember("user-b", "second");

  assert.equal(store.forget("user-b", first.memory.id), false);
  assert.equal(store.forget("user-a", first.memory.id), true);
  assert.equal(store.forget("user-a", first.memory.id), false);
  assert.equal(store._db.prepare("SELECT COUNT(*) AS count FROM memories").get()?.count, 1);
});

test("memory inputs and persisted embeddings are validated explicitly", async (context) => {
  const { store } = createStore({
    valid: normalizedVector({ 0: 1 }),
    query: normalizedVector({ 0: 1 }),
  });
  context.after(() => store.close());

  await assert.rejects(store.remember(" ", "valid"), MemoryValidationError);
  await assert.rejects(store.remember("user", " "), MemoryValidationError);
  await store.remember("user", "valid");
  store._db.exec("PRAGMA ignore_check_constraints = ON");
  store._db.prepare("UPDATE memories SET embedding = ?").run(new Uint8Array(8));
  await assert.rejects(store.recall("user", "query"), InvalidEmbeddingError);
});

test("recall returns only qualifying results, ordered and limited to top three", async (context) => {
  const { store } = createStore({
    query: normalizedVector({ 0: 1 }),
    top: vectorWithFirstComponent(0.9, 1),
    tieLaterId: vectorWithFirstComponent(0.8, 2),
    tieEarlierId: vectorWithFirstComponent(0.8, 3),
    third: vectorWithFirstComponent(0.7, 4),
    fourth: vectorWithFirstComponent(0.6, 5),
    threshold: vectorWithFirstComponent(0.3, 6),
    below: vectorWithFirstComponent(0.2, 7),
  });
  context.after(() => store.close());
  for (const fact of [
    "top",
    "tieLaterId",
    "tieEarlierId",
    "third",
    "fourth",
    "threshold",
    "below",
  ]) {
    await store.remember("user-a", fact);
  }
  await store.remember("user-b", "top");

  const results = await store.recall("user-a", "query");
  assert.deepEqual(results.map(({ memory }) => memory.fact), [
    "top",
    "tieLaterId",
    "tieEarlierId",
  ]);
  assert.ok(results.every(({ score }) => score >= 0.3));
  assert.deepEqual(await store.recall("nobody", "query"), []);
});

test("recall filters below threshold before applying a smaller requested limit", async (context) => {
  const { store } = createStore({
    query: normalizedVector({ 0: 1 }),
    belowFirst: vectorWithFirstComponent(0.2, 1),
    eligible: vectorWithFirstComponent(0.4, 2),
  });
  context.after(() => store.close());
  await store.remember("user", "belowFirst");
  await store.remember("user", "eligible");

  const results = await store.recall("user", "query", 1);
  assert.deepEqual(results.map(({ memory }) => memory.fact), ["eligible"]);
});

test("recall matches a semantic paraphrase without shared words", async (context) => {
  const { store } = createStore({
    "A janela de manutenção ocorre na terça-feira.": vectorWithFirstComponent(0.85),
    "Em qual dia podemos efetuar a implantação?": normalizedVector({ 0: 1 }),
  });
  context.after(() => store.close());
  await store.remember("user", "A janela de manutenção ocorre na terça-feira.");

  const results = await store.recall("user", "Em qual dia podemos efetuar a implantação?");
  assert.equal(results[0]?.memory.fact, "A janela de manutenção ocorre na terça-feira.");
  assert.ok(results[0] && results[0].score >= 0.3);
});

test("recall accepts the default top-three limit and caps larger limits", async (context) => {
  const vectors: Record<string, Float32Array> = { query: normalizedVector({ 0: 1 }) };
  let next = 1;
  const store = new SqliteMemoryStore(":memory:", {
    embed: async (text) => vectors[text] ?? vectorWithFirstComponent(0.5, next++),
  });
  context.after(() => store.close());
  for (const fact of ["one", "two", "three", "four"]) {
    await store.remember("user", fact);
  }

  assert.equal((await store.recall("user", "query", 99)).length, 3);
});
