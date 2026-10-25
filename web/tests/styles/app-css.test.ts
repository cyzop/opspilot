import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fontSize, space } from "../../src/styles/tokens.ts";

const css = readFileSync(new URL("../../src/styles/app.css", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

// Hairlines (borders, outlines, the visually-hidden clip) are the only literal px allowed.
const HAIRLINES = new Set([1, 2]);
const SCALE = new Set<number>([...space, ...fontSize]);

test("app.css uses no px value outside the spacing/type scales", () => {
  const offenders = [...css.matchAll(/(-?\d*\.?\d+)px/g)]
    .map((match) => Number(match[1]))
    .filter((value) => !HAIRLINES.has(value) && !SCALE.has(value));
  assert.deepEqual(offenders, []);
});

test("app.css has no literal colours; every colour comes from a token", () => {
  assert.deepEqual(css.match(/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/gi) ?? [], []);
});

test("every var(--color-*) used in app.css exists in the palette", async () => {
  const { palettes } = await import("../../src/styles/tokens.ts");
  const roles = new Set(Object.keys(palettes.light));
  const used = [...css.matchAll(/var\(--color-([a-z-]+)\)/g)].map((match) => match[1] ?? "");
  assert.deepEqual(used.filter((role) => !roles.has(role)), []);
});
