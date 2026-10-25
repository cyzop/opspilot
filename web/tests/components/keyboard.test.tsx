import assert from "node:assert/strict";
import test from "node:test";
import { fireEvent, render, screen } from "@testing-library/react";
import { App } from "../../src/App.tsx";
import { memoryStorage } from "../helpers/dom.ts";
import { answerBody, fakeFetch, pendingBody } from "../helpers/fixtures.ts";

// jsdom does not move focus on Tab, so the tab order is the DOM order of focusable elements
// (no positive tabindex anywhere). This lists that order by accessible name.
function tabOrder(): string[] {
  const focusable = [...document.querySelectorAll<HTMLElement>("button, input, textarea, select, a[href], [tabindex]")]
    .filter((element) => !element.closest("dialog:not([open])"))
    .filter((element) => !(element as HTMLButtonElement).disabled && element.tabIndex >= 0);
  return focusable.map(accessibleName);
}

function accessibleName(element: HTMLElement): string {
  const label = element.getAttribute("aria-label");
  if (label) return label;
  const labels = (element as HTMLInputElement).labels;
  if (labels && labels.length > 0) return labels[0]?.textContent?.trim() ?? "";
  const copy = element.cloneNode(true) as HTMLElement;
  copy.querySelectorAll("[aria-hidden='true']").forEach((node) => node.remove());
  return copy.textContent?.trim() ?? "";
}

const press = (element: Element, key: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(element, { key, ...init });

async function sendByKeyboard(message: string) {
  const input = screen.getByLabelText("Mensagem");
  input.focus();
  fireEvent.change(input, { target: { value: message } });
  press(input, "Enter");
}

test("Tab goes header → conversation controls → composer, with no positive tabindex", async () => {
  const { fetch } = fakeFetch([{ status: 200, body: answerBody() }, { status: 202, body: pendingBody() }, { status: 0 }]);
  render(<App fetch={fetch} storage={memoryStorage()} />);
  await sendByKeyboard("Quais alertas?");
  await screen.findByText("Há 2 alertas ativos.", { selector: ".bubble-text" });
  await sendByKeyboard("Resolva o incidente incident-001");
  await screen.findByRole("region", { name: "Aprovação necessária" });
  await sendByKeyboard("E agora?");
  await screen.findByRole("button", { name: "Tentar de novo" });

  fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: "próxima" } });
  assert.deepEqual(document.querySelectorAll("[tabindex]:not([tabindex='0']):not([tabindex='-1'])").length, 0);
  assert.deepEqual(tabOrder(), [
    "Nova conversa",
    "Tema: sistema",
    "Configurações",
    "Ver raciocínio",
    "Aprovar",
    "Negar",
    "Ver raciocínio",
    "Tentar de novo",
    "Mensagem",
    "Enviar",
  ]);
});

test("every action works from the keyboard: Enter sends, buttons activate, the dialog opens and closes", async () => {
  const scripted = fakeFetch([{ status: 202, body: pendingBody() }]);
  render(<App fetch={scripted.fetch} storage={memoryStorage()} />);
  await sendByKeyboard("Resolva o incidente incident-001");
  await screen.findByRole("region", { name: "Aprovação necessária" });

  // Native <button>s activate on Enter/Space; clicking them stands in for that in jsdom.
  for (const button of screen.getAllByRole("button")) assert.equal(button.tagName, "BUTTON");

  const toggle = screen.getByRole("button", { name: "Ver raciocínio" });
  toggle.focus();
  fireEvent.click(toggle);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");

  const gear = screen.getByRole("button", { name: "Configurações" });
  gear.focus();
  fireEvent.click(gear);
  const dialog = screen.getByRole("dialog", { name: "Configurações" }) as HTMLDialogElement;
  dialog.close(); // Esc
  assert.equal(document.activeElement, gear);

  const input = screen.getByLabelText("Mensagem");
  fireEvent.change(input, { target: { value: "linha 1" } });
  press(input, "Enter", { shiftKey: true });
  assert.equal(scripted.calls.length, 1, "Shift+Enter does not send");
});
