import assert from "node:assert/strict";
import test from "node:test";
import { parseArenaArgs } from "../../src/arena-cli.ts";

test("parses a question with explicit strategies and iteration limit", () => {
  assert.deepEqual(
    parseArenaArgs([
      "--strategies",
      "react,plan-and-execute",
      "--max-iterations",
      "4",
      "Como está o plantão?",
    ]),
    {
      help: false,
      input: "Como está o plantão?",
      strategies: ["react", "plan-and-execute"],
      maxIterations: 4,
      maxReflection: 2,
    },
  );
});

test("defaults to both strategies and eight model invocations", () => {
  assert.deepEqual(parseArenaArgs(["Check active alerts"]), {
    help: false,
    input: "Check active alerts",
    strategies: ["react", "plan-and-execute"],
    maxIterations: 8,
    maxReflection: 2,
  });
});

test("parses reflected selectors and max-reflection including zero", () => {
  assert.deepEqual(parseArenaArgs([
    "--strategies",
    "reflect:react,reflect:plan-and-execute",
    "--max-reflection",
    "0",
    "Check alert evidence",
  ]), {
    help: false,
    input: "Check alert evidence",
    strategies: ["reflect:react", "reflect:plan-and-execute"],
    maxIterations: 8,
    maxReflection: 0,
  });
});

test("parses help without requiring a positional question", () => {
  assert.equal(parseArenaArgs(["--help"]).help, true);
});

test("rejects missing input, invalid limits, unknown and duplicate strategies", () => {
  for (const args of [
    [],
    ["--max-iterations", "0", "question"],
    ["--max-iterations", "1.2", "question"],
    ["--max-iterations", "9007199254740992", "question"],
    ["--strategies", "react,unknown", "question"],
    ["--strategies", "reflec:react", "question"],
    ["--strategies", "react,react", "question"],
    ["--strategies", "reflect:react,reflect:react", "question"],
    ["--max-reflection", "-1", "question"],
    ["--max-reflection", "1.5", "question"],
    ["--max-reflection", "9007199254740992", "question"],
    ["--strategies", "", "question"],
    ["question", "another question"],
  ]) {
    assert.throws(() => parseArenaArgs(args), { name: "DomainValidationError" });
  }
});

test("rejects options without values and unknown flags", () => {
  assert.throws(() => parseArenaArgs(["--strategies"]), { name: "DomainValidationError" });
  assert.throws(() => parseArenaArgs(["--nope", "question"]), { name: "DomainValidationError" });
  assert.throws(() => parseArenaArgs(["--max-reflection"]), { name: "DomainValidationError" });
});
