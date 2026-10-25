import assert from "node:assert/strict";
import test from "node:test";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { App } from "../../src/App.tsx";
import { API_URL_KEY } from "../../src/lib/settings.ts";
import { assertAccessible, memoryStorage } from "../helpers/dom.ts";
import { answerBody, fakeFetch, type ScriptedResponse } from "../helpers/fixtures.ts";

function setup(script: ScriptedResponse[] = [{ status: 200, body: answerBody() }], saved: Record<string, string> = {}) {
  const scripted = fakeFetch(script);
  const storage = memoryStorage(saved);
  render(<App fetch={scripted.fetch} storage={storage} />);
  const gear = screen.getByRole("button", { name: "Configurações" });
  const open = () => {
    fireEvent.click(gear);
    const dialog = screen.getByRole("dialog", { name: "Configurações" });
    return { dialog, view: within(dialog), input: within(dialog).getByLabelText("URL da API") as HTMLInputElement };
  };
  return { ...scripted, storage, gear, open };
}

test("the gear opens a dialog with the current API URL", async () => {
  const { open } = setup(undefined, { [API_URL_KEY]: "http://ops.test:8080" });
  const { input, dialog } = open();
  assert.equal(dialog.hasAttribute("open"), true);
  assert.equal(input.value, "http://ops.test:8080");
  assert.equal(input.type, "url");
  await assertAccessible();
});

test("an invalid URL shows the error by the field and Salvar does not close", () => {
  const { open, storage } = setup();
  const { view, input, dialog } = open();
  fireEvent.change(input, { target: { value: "localhost:3000" } });
  fireEvent.click(view.getByRole("button", { name: "Salvar" }));
  const error = view.getByText(/Informe uma URL http ou https completa/);
  assert.ok((input.getAttribute("aria-describedby") ?? "").split(" ").includes(error.id));
  assert.equal(input.getAttribute("aria-invalid"), "true");
  assert.equal(dialog.hasAttribute("open"), true);
  assert.equal(storage.data.has(API_URL_KEY), false);
});

test("Testar conexão reports the result in a status without saving", async () => {
  const { open, calls, storage } = setup([{ status: 200, body: {} }, { status: 0 }]);
  const { view, input } = open();
  fireEvent.change(input, { target: { value: "http://ops.test:9000" } });
  fireEvent.click(view.getByRole("button", { name: "Testar conexão" }));
  const status = view.getByRole("status");
  await within(status).findByText("Conectado");
  assert.equal(calls[0]?.url, "http://ops.test:9000/stats?since=1m");
  fireEvent.click(view.getByRole("button", { name: "Testar conexão" }));
  await within(status).findByText(/Não foi possível conectar à API/);
  assert.equal(storage.data.has(API_URL_KEY), false);
});

test("Cancelar and Esc close without changes and return focus to the gear", () => {
  const { open, gear, storage } = setup();
  let { view, input, dialog } = open();
  fireEvent.change(input, { target: { value: "http://changed.test" } });
  fireEvent.click(view.getByRole("button", { name: "Cancelar" }));
  assert.equal(dialog.hasAttribute("open"), false);
  assert.equal(document.activeElement, gear);

  ({ view, input, dialog } = open());
  assert.equal(input.value, "http://localhost:3000", "the draft was discarded");
  (dialog as HTMLDialogElement).close(); // what the browser does on Esc
  assert.equal(dialog.hasAttribute("open"), false);
  assert.equal(document.activeElement, gear);
  assert.equal(storage.data.has(API_URL_KEY), false);
});

test("Salvar persists, sends the next message to the new API and starts a new conversation", async () => {
  const { open, storage, calls, gear } = setup([
    { status: 200, body: answerBody() },
    { status: 200, body: answerBody({ conversationId: "conv-2" }) },
  ]);
  fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: "Quais alertas?" } });
  fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
  await screen.findByText("Há 2 alertas ativos.", { selector: ".bubble-text" });
  assert.equal(calls[0]?.url, "http://localhost:3000/chat");

  const { view, input, dialog } = open();
  fireEvent.change(input, { target: { value: "https://ops.example/api/" } });
  fireEvent.click(view.getByRole("button", { name: "Salvar" }));
  assert.equal(dialog.hasAttribute("open"), false);
  assert.equal(document.activeElement, gear);
  assert.equal(storage.data.get(API_URL_KEY), "https://ops.example/api");
  screen.getByText(/A URL da API mudou/);

  fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: "E agora?" } });
  fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
  await screen.findAllByText("Há 2 alertas ativos.", { selector: ".bubble-text" });
  assert.equal(calls[1]?.url, "https://ops.example/api/chat");
  assert.deepEqual(JSON.parse(String(calls[1]?.init?.body)), { message: "E agora?" }, "no old conversationId");
});
