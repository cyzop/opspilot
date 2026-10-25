import assert from "node:assert/strict";
import test from "node:test";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { App } from "../../src/App.tsx";
import { assertAccessible, memoryStorage } from "../helpers/dom.ts";
import { approvalBody, decisionBody, fakeFetch, pendingBody, type ScriptedResponse } from "../helpers/fixtures.ts";

async function pendingCard(rest: ScriptedResponse[]) {
  const scripted = fakeFetch([{ status: 202, body: pendingBody() }, ...rest]);
  render(<App fetch={scripted.fetch} storage={memoryStorage()} />);
  fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: "Resolva o incidente incident-001" } });
  fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
  const card = await screen.findByRole("region", { name: "Aprovação necessária" });
  return { ...scripted, card };
}

test("a 202 becomes an approval card with what will run, and nothing runs yet", async () => {
  const { card, calls } = await pendingCard([]);
  const view = within(card);
  view.getByText("Resolver o incidente incident-001");
  view.getByText("resolve_incident");
  view.getByText("Alvo");
  assert.match(card.textContent ?? "", /incident-001/);
  assert.match(card.textContent ?? "", /"id": "incident-001"/);
  view.getByText("Expira às");
  assert.match(card.textContent ?? "", /\d{2}:\d{2}/);
  const approve = view.getByRole("button", { name: "Aprovar" });
  const deny = view.getByRole("button", { name: "Negar" });
  assert.ok(approve.classList.contains("button-primary"));
  assert.ok(!deny.classList.contains("button-primary"));
  view.getByRole("button", { name: "Ver raciocínio" });
  assert.equal(calls.length, 1, "only the chat call");
  await assertAccessible();
});

test("approving disables both buttons while sending, then shows Aprovado and the answer", async () => {
  const { card, calls, release } = await pendingCard([{ status: 200, body: decisionBody("approved"), hold: true }]);
  const view = within(card);
  fireEvent.click(view.getByRole("button", { name: "Aprovar" }));
  for (const name of ["Aprovar", "Negar"]) {
    const button = view.getByRole("button", { name }) as HTMLButtonElement;
    assert.equal(button.disabled, true);
    assert.equal(button.getAttribute("aria-busy"), "true");
  }
  assert.equal((screen.getByRole("button", { name: "Enviar" }) as HTMLButtonElement).disabled, true);
  release();
  await view.findByText("Aprovado");
  assert.equal(view.queryByRole("button", { name: "Aprovar" }), null);
  await screen.findByText("Incidente incident-001 resolvido após aprovação do operador.", { selector: ".bubble-text" });
  assert.equal(calls[1]?.url.endsWith("/approvals/appr-1/decision"), true);
  assert.deepEqual(JSON.parse(String(calls[1]?.init?.body)), { decision: "approve" });
  assert.equal(screen.getAllByRole("button", { name: "Ver raciocínio" }).length, 2);
  await assertAccessible();
});

test("denying shows Negado and the denial answer", async () => {
  const { card, calls } = await pendingCard([{ status: 200, body: decisionBody("denied") }]);
  fireEvent.click(within(card).getByRole("button", { name: "Negar" }));
  await within(card).findByText("Negado");
  await screen.findByText("Resolução do incidente incident-001 negada pelo operador; nada foi alterado.", { selector: ".bubble-text" });
  assert.deepEqual(JSON.parse(String(calls[1]?.init?.body)), { decision: "deny" });
});

test("an expired or already decided approval shows that it is no longer pending", async () => {
  const { card } = await pendingCard([{ status: 409, body: { error: "Approval is no longer pending", approval: approvalBody({ status: "expired" }) } }]);
  fireEvent.click(within(card).getByRole("button", { name: "Aprovar" }));
  await within(card).findByText("Não está mais pendente");
  assert.equal(within(card).queryByRole("button", { name: "Aprovar" }), null);
});

test("a failed decision shows the error and the buttons come back", async () => {
  const { card } = await pendingCard([{ status: 0 }]);
  fireEvent.click(within(card).getByRole("button", { name: "Aprovar" }));
  await within(card).findByText(/Não foi possível conectar/);
  assert.equal((within(card).getByRole("button", { name: "Aprovar" }) as HTMLButtonElement).disabled, false);
  await assertAccessible();
});
