import assert from "node:assert/strict";
import test from "node:test";
import { render, screen } from "@testing-library/react";
import "./helpers/dom.ts";
import { App } from "../src/App.tsx";
import { fakeFetch } from "./helpers/fixtures.ts";
import { memoryStorage } from "./helpers/dom.ts";

test("the war room renders its single h1 and landmarks", () => {
  render(<App fetch={fakeFetch([]).fetch} storage={memoryStorage()} />);
  const headings = screen.getAllByRole("heading", { level: 1 });
  assert.equal(headings.length, 1);
  assert.equal(headings[0]?.textContent, "War Room");
  assert.ok(screen.getByRole("main"));
  assert.ok(screen.getByRole("banner"));
});
