import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { tokensCss } from "../../src/styles/generate-tokens-css.ts";

test("tokens.css is in sync with tokens.ts (regenerate with generate-tokens-css.ts)", () => {
  const css = readFileSync(new URL("../../src/styles/tokens.css", import.meta.url), "utf8");
  assert.equal(css.replaceAll("\r\n", "\n"), tokensCss());
});

test("tokens.css defines both dark-mode paths and reduced motion", () => {
  const css = tokensCss();
  assert.match(css, /@media \(prefers-color-scheme: dark\) \{\n  :root:not\(\[data-theme="light"\]\)/);
  assert.match(css, /:root\[data-theme="dark"\] \{/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /--space-8: 64px;/);
});
