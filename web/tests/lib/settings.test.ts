import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient, NETWORK_MESSAGE } from "../../src/lib/api-client.ts";
import { API_CHANGED_NOTICE, chatReducer, initialChatState } from "../../src/lib/chat-state.ts";
import { chatAnswerSchema } from "../../src/lib/api-schemas.ts";
import { API_URL_KEY, DEFAULT_API_URL, INVALID_URL_MESSAGE, loadApiUrl, saveApiUrl, validateApiUrl } from "../../src/lib/settings.ts";
import { brokenStorage, memoryStorage } from "../helpers/dom.ts";
import { answerBody, fakeFetch } from "../helpers/fixtures.ts";

test("validateApiUrl accepts http(s) URLs and drops the trailing slash", () => {
  assert.deepEqual(validateApiUrl("http://localhost:3000"), { ok: true, url: "http://localhost:3000" });
  assert.deepEqual(validateApiUrl(" https://ops.example/api/ "), { ok: true, url: "https://ops.example/api" });
});

test("validateApiUrl rejects other schemes, relative URLs, credentials, query, hash and empty", () => {
  for (const raw of ["ftp://x", "localhost:3000", "", "   "]) {
    assert.deepEqual(validateApiUrl(raw), { ok: false, message: INVALID_URL_MESSAGE }, raw);
  }
  assert.match((validateApiUrl("http://user:pw@x") as { message: string }).message, /usuário ou senha/);
  assert.match((validateApiUrl("http://x/?q=1") as { message: string }).message, /parâmetros/);
  assert.match((validateApiUrl("http://x/#h") as { message: string }).message, /âncora/);
});

test("saveApiUrl and loadApiUrl round-trip under opspilot.apiUrl", () => {
  const storage = memoryStorage();
  assert.equal(loadApiUrl(storage), DEFAULT_API_URL);
  assert.equal(saveApiUrl("http://ops.test:8080", storage), true);
  assert.equal(storage.data.get(API_URL_KEY), "http://ops.test:8080");
  assert.equal(loadApiUrl(storage), "http://ops.test:8080");
});

test("an invalid saved value or a blocked storage falls back to the default", () => {
  assert.equal(loadApiUrl(memoryStorage({ [API_URL_KEY]: "javascript:alert(1)" })), DEFAULT_API_URL);
  assert.equal(loadApiUrl(brokenStorage), DEFAULT_API_URL);
  assert.equal(saveApiUrl("http://x", brokenStorage), false);
});

test("testConnection calls GET stats?since=1m and reports the outcome", async () => {
  const ok = fakeFetch([{ status: 200, body: {} }]);
  assert.deepEqual(await createApiClient({ baseUrl: "http://api.test/", fetch: ok.fetch }).testConnection(), { ok: true });
  assert.equal(ok.calls[0]?.url, "http://api.test/stats?since=1m");
  assert.equal(ok.calls[0]?.init?.method, undefined);

  const down = fakeFetch([{ status: 0 }]);
  assert.deepEqual(
    await createApiClient({ baseUrl: "http://api.test", fetch: down.fetch }).testConnection(),
    { ok: false, message: NETWORK_MESSAGE },
  );

  const odd = fakeFetch([{ status: 500, body: {} }]);
  assert.deepEqual(
    await createApiClient({ baseUrl: "http://api.test", fetch: odd.fetch }).testConnection(),
    { ok: false, message: "Resposta inesperada da API (HTTP 500)." },
  );
});

test("apiChanged forgets the conversation and explains why", () => {
  const sent = chatReducer(initialChatState, { type: "send", id: "t1", message: "oi" });
  const answered = chatReducer(sent, { type: "answered", id: "t1", body: chatAnswerSchema.parse(answerBody()) });
  const changed = chatReducer(answered, { type: "apiChanged" });
  assert.equal(changed.conversationId, null);
  assert.equal(changed.notice, API_CHANGED_NOTICE);
  assert.equal(changed.turns.length, 1);
  assert.equal(chatReducer(initialChatState, { type: "apiChanged" }).notice, null);
});
