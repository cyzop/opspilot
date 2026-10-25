import assert from "node:assert/strict";
import test from "node:test";
import { OutputParserException } from "@langchain/core/output_parsers";
import { ConfigurationError, ModelUnavailableError, StrategyLimitError } from "../../src/domain/errors.ts";
import { classifyModelError } from "../../src/llm/model-errors.ts";
import { httpError } from "../helpers/fake-chat-model.ts";

test("budget, configuration, abort and final model errors are never retried or switched", () => {
  const abortError = Object.assign(new Error("aborted"), { name: "AbortError" });
  for (const error of [
    new StrategyLimitError("limit"),
    new ConfigurationError("config"),
    abortError,
    new ModelUnavailableError("down"),
  ]) {
    assert.equal(classifyModelError(error), "abort", error.name);
  }
});

test("client-side HTTP errors are permanent", () => {
  for (const status of [400, 401, 403, 404, 422]) {
    assert.equal(classifyModelError(httpError(status)), "permanent", String(status));
  }
  const nested = Object.assign(new Error("bad"), { response: { status: 400 } });
  assert.equal(classifyModelError(nested), "permanent");
});

test("rate limits, server errors, network errors and parse failures are transient", () => {
  for (const status of [408, 409, 425, 429, 500, 502, 503]) {
    assert.equal(classifyModelError(httpError(status)), "transient", String(status));
  }
  assert.equal(classifyModelError(new Error("socket hang up")), "transient");
  assert.equal(classifyModelError(new OutputParserException("Failed to parse. Text: \"\"")), "transient");
  assert.equal(classifyModelError("not an error"), "transient");
});
