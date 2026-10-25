import assert from "node:assert/strict";
import test from "node:test";
import { corsHeaders, DEFAULT_CORS_ORIGINS, parseCorsOrigins } from "../../src/http/cors.ts";

test("parseCorsOrigins defaults to the war room dev origin", () => {
  assert.deepEqual(parseCorsOrigins(undefined), ["http://localhost:5173"]);
  assert.deepEqual(parseCorsOrigins("  "), DEFAULT_CORS_ORIGINS);
});

test("parseCorsOrigins reads a comma-separated list of exact origins", () => {
  assert.deepEqual(parseCorsOrigins("http://a.test, https://b.test:8443"), ["http://a.test", "https://b.test:8443"]);
});

test("parseCorsOrigins rejects wildcards, paths and other protocols", () => {
  for (const raw of ["*", "http://a.test/path", "ftp://x", "a.test", "http://a.test,*"]) {
    assert.throws(() => parseCorsOrigins(raw), { name: "ConfigurationError" }, raw);
  }
});

const allowed = ["http://localhost:5173"];

test("an allowed origin gets the simple CORS headers", () => {
  assert.deepEqual(corsHeaders({ origin: "http://localhost:5173", method: "POST" }, allowed), {
    "Access-Control-Allow-Origin": "http://localhost:5173",
    "Vary": "Origin",
    "Access-Control-Expose-Headers": "X-Request-Id",
  });
});

test("a preflight from an allowed origin also gets methods, headers and max age", () => {
  assert.deepEqual(corsHeaders({ origin: "http://localhost:5173", method: "OPTIONS", requestMethod: "POST" }, allowed), {
    "Access-Control-Allow-Origin": "http://localhost:5173",
    "Vary": "Origin",
    "Access-Control-Expose-Headers": "X-Request-Id",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "600",
  });
});

test("disallowed or missing origins get no CORS headers", () => {
  assert.equal(corsHeaders({ origin: "http://evil.example", method: "GET" }, allowed), null);
  assert.equal(corsHeaders({ origin: "http://localhost:5173.evil.example", method: "GET" }, allowed), null);
  assert.equal(corsHeaders({ origin: undefined, method: "GET" }, allowed), null);
});
