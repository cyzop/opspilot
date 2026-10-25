import assert from "node:assert/strict";
import test from "node:test";
import { createCheckProviderStatusTool } from "../../src/tools/check-provider-status.ts";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

test("checks GitHub by default and returns its compact status", async () => {
  const requested: string[] = [];
  const checkStatus = createCheckProviderStatusTool(async (input) => {
    requested.push(String(input));
    return response({
      status: { indicator: "none", description: "All Systems Operational" },
    });
  });

  const result = await checkStatus.invoke({});

  assert.match(checkStatus.description, /suspeita de problema externo/i);
  assert.match(checkStatus.description, /alertas internos/i);
  assert.deepEqual(requested, ["https://www.githubstatus.com/api/v2/status.json"]);
  assert.equal(result, "github está none - All Systems Operational");
  assert.equal(result.includes("\n"), false);
});

test("rejects an unsupported provider", async () => {
  const checkStatus = createCheckProviderStatusTool(async () => response({
    status: { indicator: "none", description: "All Systems Operational" },
  }));

  await assert.rejects(checkStatus.invoke({ provider: "aws" } as never));
});

test("checks Cloudflare and preserves a non-healthy provider status", async () => {
  const requested: string[] = [];
  const checkStatus = createCheckProviderStatusTool(async (input) => {
    requested.push(String(input));
    return response({
      status: { indicator: "major", description: "Partial System Outage" },
    });
  });

  const result = await checkStatus.invoke({ provider: "cloudflare" });

  assert.deepEqual(requested, ["https://www.cloudflarestatus.com/api/v2/status.json"]);
  assert.equal(result, "cloudflare está major - Partial System Outage");
  assert.equal(result.includes("\n"), false);
});

test("retries a network failure once and succeeds on the second attempt", async () => {
  let calls = 0;
  const signals: (AbortSignal | null | undefined)[] = [];
  const checkStatus = createCheckProviderStatusTool(async (_input, init) => {
    calls += 1;
    signals.push(init?.signal);
    if (calls === 1) throw new TypeError("network unavailable");
    return response({
      status: { indicator: "minor", description: "Elevated Errors" },
    });
  });

  const result = await checkStatus.invoke({});

  assert.equal(calls, 2);
  assert.ok(signals.every((signal) => signal instanceof AbortSignal));
  assert.notEqual(signals[0], signals[1]);
  assert.equal(result, "github está minor - Elevated Errors");
});

test("retries a timed-out request once", async () => {
  let calls = 0;
  const signals: (AbortSignal | null | undefined)[] = [];
  const checkStatus = createCheckProviderStatusTool(async (_input, init) => {
    calls += 1;
    signals.push(init?.signal);
    if (calls === 1) {
      throw new DOMException("The operation timed out", "TimeoutError");
    }
    return response({
      status: { indicator: "none", description: "All Systems Operational" },
    });
  });

  const result = await checkStatus.invoke({});

  assert.equal(calls, 2);
  assert.ok(signals.every((signal) => signal instanceof AbortSignal));
  assert.notEqual(signals[0], signals[1]);
  assert.equal(result, "github está none - All Systems Operational");
});

test("retries an HTTP 5xx once and returns a readable error when exhausted", async () => {
  let calls = 0;
  const checkStatus = createCheckProviderStatusTool(async () => {
    calls += 1;
    return response({}, 503);
  });

  const result = await checkStatus.invoke({});

  assert.equal(calls, 2);
  assert.match(String(result), /github/i);
  assert.match(String(result), /503/);
  assert.equal(String(result).includes("\n"), false);
});

test("normalizes provider text to a single line", async () => {
  const checkStatus = createCheckProviderStatusTool(async () => response({
    status: { indicator: "minor\n", description: "Elevated\nErrors" },
  }));

  const result = await checkStatus.invoke({});

  assert.equal(result, "github está minor - Elevated Errors");
});

test("does not retry other HTTP errors", async () => {
  let calls = 0;
  const checkStatus = createCheckProviderStatusTool(async () => {
    calls += 1;
    return response({}, 429);
  });

  const result = await checkStatus.invoke({});

  assert.equal(calls, 1);
  assert.match(String(result), /429/);
});

test("returns a readable error without retrying invalid JSON", async () => {
  let calls = 0;
  const checkStatus = createCheckProviderStatusTool(async () => {
    calls += 1;
    return new Response("{", { status: 200 });
  });

  const result = await checkStatus.invoke({});

  assert.equal(calls, 1);
  assert.match(String(result), /inválid|invalid/i);
  assert.equal(String(result).includes("\n"), false);
});

test("returns a readable error without retrying missing or empty status fields", async () => {
  let calls = 0;
  const checkStatus = createCheckProviderStatusTool(async () => {
    calls += 1;
    return response({ status: { indicator: " ", description: "" } });
  });

  const result = await checkStatus.invoke({});

  assert.equal(calls, 1);
  assert.match(String(result), /inválid|invalid/i);
});

test("returns a readable error after two network failures without throwing", async () => {
  let calls = 0;
  const checkStatus = createCheckProviderStatusTool(async () => {
    calls += 1;
    throw new Error("connection refused");
  });

  const result = await checkStatus.invoke({});

  assert.equal(calls, 2);
  assert.match(String(result), /não consegui consultar/i);
  assert.match(String(result), /connection refused/);
  assert.equal(String(result).includes("\n"), false);
});
