import assert from "node:assert/strict";
import test from "node:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { App } from "../../src/App.tsx";
import { loadTheme, nextTheme, THEME_KEY } from "../../src/lib/theme.ts";
import { brokenStorage, memoryStorage } from "../helpers/dom.ts";
import { fakeFetch } from "../helpers/fixtures.ts";

const root = () => document.documentElement;

test("nextTheme cycles system → light → dark → system", () => {
  assert.equal(nextTheme("system"), "light");
  assert.equal(nextTheme("light"), "dark");
  assert.equal(nextTheme("dark"), "system");
});

test("loadTheme ignores unknown values and blocked storage", () => {
  assert.equal(loadTheme(memoryStorage({ [THEME_KEY]: "neon" })), "system");
  assert.equal(loadTheme(brokenStorage), "system");
  assert.equal(loadTheme(memoryStorage({ [THEME_KEY]: "dark" })), "dark");
});

test("the toggle follows the system by default, then sets and saves light and dark", () => {
  const storage = memoryStorage();
  render(<App fetch={fakeFetch([]).fetch} storage={storage} />);
  assert.equal(root().hasAttribute("data-theme"), false);

  fireEvent.click(screen.getByRole("button", { name: "Tema: sistema" }));
  assert.equal(root().getAttribute("data-theme"), "light");
  assert.equal(storage.data.get(THEME_KEY), "light");

  fireEvent.click(screen.getByRole("button", { name: "Tema: claro" }));
  assert.equal(root().getAttribute("data-theme"), "dark");

  fireEvent.click(screen.getByRole("button", { name: "Tema: escuro" }));
  assert.equal(root().hasAttribute("data-theme"), false);
  assert.equal(storage.data.get(THEME_KEY), "system");
});

test("a saved theme applies on load, and blocked storage does not crash", () => {
  render(<App fetch={fakeFetch([]).fetch} storage={memoryStorage({ [THEME_KEY]: "dark" })} />);
  assert.equal(root().getAttribute("data-theme"), "dark");
  screen.getByRole("button", { name: "Tema: escuro" });
});

test("blocked storage still lets the operator switch themes", () => {
  render(<App fetch={fakeFetch([]).fetch} storage={brokenStorage} />);
  fireEvent.click(screen.getByRole("button", { name: "Tema: sistema" }));
  assert.equal(root().getAttribute("data-theme"), "light");
});
