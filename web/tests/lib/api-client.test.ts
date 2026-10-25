import assert from "node:assert/strict";
import test from "node:test";
import { createApiClient, joinUrl, NETWORK_MESSAGE, TIMEOUT_MESSAGE } from "../../src/lib/api-client.ts";
import { answerBody, fakeFetch } from "../helpers/fixtures.ts";

test("joinUrl never doubles slashes", () => {
  assert.equal(joinUrl("http://x:3000/", "/chat"), "http://x:3000/chat");
  assert.equal(joinUrl("http://x:3000/api", "chat"), "http://x:3000/api/chat");
});

test("chat 200 is parsed into an answer and sends conversationId", async () => {
  const { fetch, calls } = fakeFetch([{ status: 200, body: answerBody() }]);
  const client = createApiClient({ baseUrl: "http://api.test/", fetch });
  const result = await client.chat({ message: "oi", conversationId: "conv-1" });
  assert.equal(result.ok && result.kind, "answer");
  assert.equal(calls[0]?.url, "http://api.test/chat");
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { message: "oi", conversationId: "conv-1" });
  assert.equal((calls[0]?.init?.headers as Record<string, string>)["Content-Type"], "application/json");
});

test("chat without conversationId omits it", async () => {
  const { fetch, calls } = fakeFetch([{ status: 200, body: answerBody() }]);
  await createApiClient({ baseUrl: "http://api.test", fetch }).chat({ message: "oi", conversationId: null });
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { message: "oi" });
});

test("HTTP errors become plain-language ApiErrors with the request id", async () => {
  const cases: Array<[number, RegExp]> = [
    [400, /recusada/],
    [404, /conversa não existe/],
    [503, /Nenhum modelo/],
    [504, /demorou demais/],
    [500, /HTTP 500/],
  ];
  for (const [status, message] of cases) {
    const { fetch } = fakeFetch([{ status, body: { error: "raw server text", requestId: "req-9" } }]);
    const result = await createApiClient({ baseUrl: "http://api.test", fetch }).chat({ message: "oi" });
    assert.equal(result.ok, false);
    if (result.ok) continue;
    assert.equal(result.error.kind, "http");
    assert.equal(result.error.status, status);
    assert.match(result.error.message, message);
    assert.doesNotMatch(result.error.message, /raw server text/);
    assert.equal(result.error.requestId, "req-9");
  }
});

test("the X-Request-Id header is used when the body has no requestId", async () => {
  const { fetch } = fakeFetch([{ status: 500, raw: "not json", headers: { "X-Request-Id": "req-h" } }]);
  const result = await createApiClient({ baseUrl: "http://api.test", fetch }).chat({ message: "oi" });
  assert.equal(!result.ok && result.error.requestId, "req-h");
});

test("a rejected fetch is a network error", async () => {
  const fetch = (async () => {
    throw new TypeError("Failed to fetch");
  }) as typeof globalThis.fetch;
  const result = await createApiClient({ baseUrl: "http://api.test", fetch }).chat({ message: "oi" });
  assert.deepEqual(!result.ok && result.error, { kind: "network", message: NETWORK_MESSAGE });
});

test("the client aborts after its timeout", async () => {
  const fetch = ((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  })) as typeof globalThis.fetch;
  const result = await createApiClient({ baseUrl: "http://api.test", fetch, timeoutMs: 5 }).chat({ message: "oi" });
  assert.deepEqual(!result.ok && result.error, { kind: "timeout", message: TIMEOUT_MESSAGE });
});

test("a 200 body with the wrong shape is invalid_response", async () => {
  const { answer: _dropped, ...broken } = answerBody();
  const { fetch } = fakeFetch([{ status: 200, body: broken, headers: { "X-Request-Id": "req-x" } }]);
  const result = await createApiClient({ baseUrl: "http://api.test", fetch }).chat({ message: "oi" });
  assert.equal(!result.ok && result.error.kind, "invalid_response");
  assert.equal(!result.ok && result.error.requestId, "req-x");
});
