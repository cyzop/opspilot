import assert from "node:assert/strict";
import test from "node:test";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { assertAccessible, memoryStorage } from "../helpers/dom.ts";
import { App } from "../../src/App.tsx";
import { TraceToggle } from "../../src/components/TraceToggle.tsx";
import { answerBody, fakeFetch } from "../helpers/fixtures.ts";

const metrics = { llmCalls: 2, latencyMs: 812.4, promptTokens: null, historyMessages: 0, modelUsed: "openrouter/free" };

async function answered() {
  const { fetch } = fakeFetch([{ status: 200, body: answerBody() }]);
  render(<App fetch={fetch} storage={memoryStorage()} />);
  fireEvent.change(screen.getByLabelText("Mensagem"), { target: { value: "Quais alertas?" } });
  fireEvent.click(screen.getByRole("button", { name: "Enviar" }));
  await screen.findByText("Há 2 alertas ativos.", { selector: ".bubble-text" });
}

test("Ver raciocínio is closed by default and opens the ordered trace", async () => {
  await answered();
  const toggle = screen.getByRole("button", { name: "Ver raciocínio" });
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  const panelId = toggle.getAttribute("aria-controls") ?? "";
  assert.ok(document.getElementById(panelId)?.hidden);

  fireEvent.click(toggle);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  const list = screen.getByRole("list", { name: "Etapas do raciocínio" });
  const items = within(list).getAllByRole("listitem");
  assert.deepEqual(items.map((item) => item.querySelector(".trace-label")?.textContent), ["Rota", "Ação", "Observação", "Resposta"]);
  assert.match(items[1]?.textContent ?? "", /list_alerts/);
  assert.match(items[1]?.textContent ?? "", /"status": "firing"/);
  assert.match(items[0]?.textContent ?? "", /etapa: router/);
  await assertAccessible();

  fireEvent.click(toggle);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
});

test("the metrics summary shows model, calls, latency and prompt tokens", () => {
  render(<TraceToggle trace={[]} metrics={metrics} />);
  fireEvent.click(screen.getByRole("button", { name: "Ver raciocínio" }));
  const summary = screen.getByLabelText("Métricas do turno");
  const text = summary.textContent ?? "";
  for (const expected of ["Modelo", "openrouter/free", "Chamadas ao modelo", "2", "Latência (ms)", "812", "Tokens de prompt", "não disponível"]) {
    assert.ok(text.includes(expected), expected);
  }
});

test("an empty trace shows its empty state", () => {
  render(<TraceToggle trace={[]} metrics={metrics} />);
  fireEvent.click(screen.getByRole("button", { name: "Ver raciocínio" }));
  assert.ok(screen.getByText("Nenhuma etapa de raciocínio registrada."));
});

test("trace content with markup and unknown kinds render as text", () => {
  render(<TraceToggle trace={[{ type: "observation", content: "<img src=x onerror=alert(1)>" }, { type: "novo", content: "x" }]} metrics={metrics} />);
  fireEvent.click(screen.getByRole("button", { name: "Ver raciocínio" }));
  assert.ok(screen.getByText("<img src=x onerror=alert(1)>"));
  assert.equal(document.querySelector("img"), null);
  assert.ok(screen.getByText("Etapa (novo)"));
});
