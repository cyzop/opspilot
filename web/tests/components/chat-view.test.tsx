import assert from "node:assert/strict";
import test from "node:test";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { assertAccessible, memoryStorage } from "../helpers/dom.ts";
import { App } from "../../src/App.tsx";
import { answerBody, fakeFetch } from "../helpers/fixtures.ts";

const input = () => screen.getByLabelText("Mensagem") as HTMLTextAreaElement;
const sendButton = () => screen.getByRole("button", { name: "Enviar" }) as HTMLButtonElement;

test("empty state explains the war room and its examples send a message", async () => {
  const { fetch, calls } = fakeFetch([{ status: 200, body: answerBody() }]);
  render(<App fetch={fetch} storage={memoryStorage()} />);
  assert.ok(screen.getByRole("heading", { name: "Pronto para o plantão" }));
  const examples = screen.getAllByRole("button", { name: /\?$|abertos$/ });
  assert.equal(examples.length, 3);
  await assertAccessible();

  fireEvent.click(screen.getByRole("button", { name: "Quais alertas estão ativos?" }));
  await screen.findByText("Há 2 alertas ativos.");
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { message: "Quais alertas estão ativos?" });
});

test("sending shows a skeleton, disables Enviar and then shows the answer in one conversation", async () => {
  const scripted = fakeFetch([
    { status: 200, body: answerBody(), hold: true },
    { status: 200, body: answerBody({ answer: "Nenhum incidente aberto." }) },
  ]);
  render(<App fetch={scripted.fetch} storage={memoryStorage()} />);

  fireEvent.change(input(), { target: { value: "Quais alertas?" } });
  fireEvent.keyDown(input(), { key: "Enter" });
  assert.ok(await screen.findByRole("status", { name: "OpsPilot está analisando" }));
  fireEvent.change(input(), { target: { value: "outra" } });
  assert.equal(sendButton().disabled, true);

  await act(async () => scripted.release());
  await screen.findByText("Há 2 alertas ativos.");
  assert.equal(screen.queryByRole("status", { name: "OpsPilot está analisando" }), null);
  await assertAccessible();

  fireEvent.click(sendButton());
  await screen.findByText("Nenhum incidente aberto.");
  assert.deepEqual(JSON.parse(String(scripted.calls[1]?.init?.body)), { message: "outra", conversationId: "conv-1" });
});

test("Shift+Enter does not send and blank messages cannot be sent", () => {
  const { fetch, calls } = fakeFetch([{ status: 200, body: answerBody() }]);
  render(<App fetch={fetch} storage={memoryStorage()} />);
  fireEvent.change(input(), { target: { value: "linha 1" } });
  fireEvent.keyDown(input(), { key: "Enter", shiftKey: true });
  assert.equal(calls.length, 0);
  fireEvent.change(input(), { target: { value: "   " } });
  assert.equal(sendButton().disabled, true);
});

test("errors are plain language, show the request id and retry keeps the message", async () => {
  const { fetch, calls } = fakeFetch([
    { status: 503, body: { error: "All models failed: provider stack trace", requestId: "req-503" } },
    { status: 200, body: answerBody() },
  ]);
  render(<App fetch={fetch} storage={memoryStorage()} />);
  fireEvent.change(input(), { target: { value: "Quais alertas?" } });
  fireEvent.click(sendButton());

  const alert = await screen.findByRole("alert");
  assert.match(alert.textContent ?? "", /Nenhum modelo disponível/);
  assert.match(alert.textContent ?? "", /req-503/);
  assert.doesNotMatch(document.body.textContent ?? "", /stack trace/);
  assert.ok(screen.getByText("Quais alertas?"));
  await assertAccessible();

  fireEvent.click(screen.getByRole("button", { name: "Tentar de novo" }));
  await screen.findByText("Há 2 alertas ativos.");
  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(String(calls[1]?.init?.body)), { message: "Quais alertas?" });
});

test("model text is rendered as text, never as markup", async () => {
  const { fetch } = fakeFetch([{ status: 200, body: answerBody({ answer: "<b>negrito</b><script>alert(1)</script>" }) }]);
  render(<App fetch={fetch} storage={memoryStorage()} />);
  fireEvent.change(input(), { target: { value: "oi" } });
  fireEvent.click(sendButton());
  await screen.findByText("<b>negrito</b><script>alert(1)</script>");
  assert.equal(document.querySelector("main b"), null);
  assert.equal(document.querySelector("main script"), null);
});

test("Nova conversa clears the conversation", async () => {
  const { fetch, calls } = fakeFetch([{ status: 200, body: answerBody() }]);
  render(<App fetch={fetch} storage={memoryStorage()} />);
  fireEvent.change(input(), { target: { value: "oi" } });
  fireEvent.click(sendButton());
  await screen.findByText("Há 2 alertas ativos.");
  fireEvent.click(screen.getByRole("button", { name: "Nova conversa" }));
  assert.ok(screen.getByRole("heading", { name: "Pronto para o plantão" }));
  fireEvent.change(input(), { target: { value: "de novo" } });
  fireEvent.click(sendButton());
  await waitFor(() => assert.equal(calls.length, 2));
  assert.deepEqual(JSON.parse(String(calls[1]?.init?.body)), { message: "de novo" });
});
