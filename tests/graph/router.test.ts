import assert from "node:assert/strict";
import test from "node:test";
import { decideRoute, ROUTER_PROMPT, routeDecisionSchema, routeFromRequest } from "../../src/graph/router.ts";
import { UnknownStrategyError } from "../../src/domain/errors.ts";
import { createFakeRouter } from "../helpers/fake-router.ts";
import { captureLogs } from "../helpers/capture-logs.ts";

test("routeDecisionSchema only accepts the three routes and a short non-empty reason", () => {
  assert.deepEqual(
    routeDecisionSchema.parse({ route: "plan-and-execute", reason: " várias ações " }),
    { route: "plan-and-execute", reason: "várias ações" },
  );
  assert.throws(() => routeDecisionSchema.parse({ route: "other", reason: "x" }));
  assert.throws(() => routeDecisionSchema.parse({ route: "react", reason: "   " }));
  assert.throws(() => routeDecisionSchema.parse({ route: "react", reason: "x".repeat(301) }));
});

test("ROUTER_PROMPT contains a routing table row for every route", () => {
  for (const route of ["react", "plan-and-execute", "reflection"]) {
    assert.match(ROUTER_PROMPT, new RegExp(`\\|\\s*${route}\\s*\\|`));
  }
});

test("decideRoute returns the router decision", async () => {
  const fake = createFakeRouter(() => ({ route: "reflection", reason: "decisão de alto impacto" }));
  const decision = await decideRoute({ router: fake.router, input: "contexto", callbacks: [] });
  assert.deepEqual(decision, {
    route: "reflection",
    reason: "decisão de alto impacto",
    source: "router",
    modelCalled: true,
  });
  assert.deepEqual(fake.calls, ["contexto"]);
});

test("decideRoute falls back to react when the router fails or returns invalid output", async (context) => {
  const logs = captureLogs(context);
  for (const behavior of [() => new Error("boom api_key=abc123"), () => ({ route: "other", reason: "?" })]) {
    const decision = await decideRoute({ router: createFakeRouter(behavior).router, input: "x", callbacks: [] });
    assert.equal(decision.route, "react");
    assert.equal(decision.source, "fallback");
    assert.equal(decision.modelCalled, true);
    assert.match(decision.reason, /^Router failed/);
    assert.doesNotMatch(decision.reason, /abc123/);
    assert.ok(decision.reason.length <= 300);
  }
  const fallbacks = logs.named("router_fallback");
  assert.equal(fallbacks.length, 2);
  for (const line of fallbacks) {
    assert.deepEqual({ level: line.level, node: line.node, route: line.route }, { level: "warn", node: "router", route: "react" });
  }
  assert.doesNotMatch(logs.lines.join(""), /abc123|Router failed/);
});

test("routeFromRequest maps optional strategies and legacy reflection forms", () => {
  assert.equal(routeFromRequest({}), undefined);
  assert.equal(routeFromRequest({ reflect: false }), undefined);
  assert.equal(routeFromRequest({ strategy: "react" }), "react");
  assert.equal(routeFromRequest({ strategy: "plan-and-execute" }), "plan-and-execute");
  assert.equal(routeFromRequest({ strategy: "reflection" }), "reflection");
  assert.equal(routeFromRequest({ strategy: "reflect:react" }), "reflection");
  assert.equal(routeFromRequest({ strategy: "reflect:plan-and-execute" }), "reflection");
  assert.equal(routeFromRequest({ strategy: "react", reflect: true }), "reflection");
  assert.equal(routeFromRequest({ reflect: true }), "reflection");
  assert.throws(() => routeFromRequest({ strategy: "custom" }), UnknownStrategyError);
  assert.throws(() => routeFromRequest({ strategy: "reflect:custom" }), UnknownStrategyError);
});
