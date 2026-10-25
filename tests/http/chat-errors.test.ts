import assert from "node:assert/strict";
import test from "node:test";
import {
  ModelUnavailableError,
  RequestTimeoutError,
  UnknownConversationError,
  UnknownStrategyError,
} from "../../src/domain/errors.ts";
import { classifyChatError } from "../../src/http/chat-errors.ts";

test("maps domain errors to status, category and message", () => {
  const cases = [
    [new UnknownConversationError("Unknown conversation: c"), 404, "unknown_conversation"],
    [new UnknownStrategyError("Unknown strategy: s"), 422, "unknown_strategy"],
    [new ModelUnavailableError("Language models are unavailable; try again later."), 503, "model_unavailable"],
    [new RequestTimeoutError("Request timed out after 1s"), 504, "timeout"],
  ] as const;
  for (const [error, status, category] of cases) {
    assert.deepEqual(classifyChatError(error), { status, category, message: error.message });
  }
});

test("malformed JSON bodies are invalid requests with a fixed message", () => {
  const parseError = Object.assign(new SyntaxError("Unexpected end of JSON input"), { type: "entity.parse.failed", status: 400 });
  assert.deepEqual(classifyChatError(parseError), { status: 400, category: "invalid_request", message: "Invalid JSON body" });
});

test("anything else is an internal error", () => {
  assert.deepEqual(classifyChatError(new Error("boom")), { status: 500, category: "internal", message: "boom" });
  assert.deepEqual(classifyChatError("x"), { status: 500, category: "internal", message: "Internal server error" });
});
