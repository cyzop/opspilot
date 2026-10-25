// Component-test helpers for node:test + jsdom (global-jsdom is loaded by the test script).
import assert from "node:assert/strict";
import { afterEach } from "node:test";
import { cleanup } from "@testing-library/react";
import axe from "axe-core";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Testing Library only auto-cleans with a global afterEach; node:test needs it explicitly.
afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("data-theme");
});

// jsdom lacks the modal dialog API; emulate the parts the page uses.
const dialogProto = globalThis.HTMLDialogElement?.prototype as (HTMLDialogElement & { __patched?: boolean }) | undefined;
if (dialogProto && !dialogProto.__patched) {
  dialogProto.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  dialogProto.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
    const EventCtor = this.ownerDocument.defaultView?.Event ?? Event;
    this.dispatchEvent(new EventCtor("close"));
  };
  dialogProto.__patched = true;
}

// jsdom has no layout; scrolling is a no-op.
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

// jsdom has no matchMedia.
if (!globalThis.matchMedia) {
  globalThis.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof globalThis.matchMedia;
}

/** Fails on serious/critical axe violations. Colour contrast is covered by the token test. */
export async function assertAccessible(node: Element = document.body): Promise<void> {
  const result = await axe.run(node, {
    rules: { "color-contrast": { enabled: false } },
    resultTypes: ["violations"],
  });
  const serious = result.violations.filter(({ impact }) => impact === "serious" || impact === "critical");
  assert.deepEqual(
    serious.map(({ id, nodes }) => `${id}: ${nodes.map(({ html }) => html).join(" | ")}`),
    [],
  );
}

export function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

export const brokenStorage = {
  getItem(): string | null {
    throw new Error("blocked");
  },
  setItem(): void {
    throw new Error("blocked");
  },
};
