import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { currentRequestId, runWithRequestContext } from "../../src/obs/request-context.ts";

test("no request id outside a scope", () => {
  assert.equal(currentRequestId(), undefined);
});

test("the id survives awaits and nested promises, and the value is returned", async () => {
  const value = await runWithRequestContext({ requestId: "r-1" }, async () => {
    await delay(1);
    const nested = await Promise.all([(async () => { await delay(1); return currentRequestId(); })()]);
    return [currentRequestId(), ...nested];
  });
  assert.deepEqual(value, ["r-1", "r-1"]);
  assert.equal(runWithRequestContext({ requestId: "r-2" }, () => currentRequestId()), "r-2");
});

test("concurrent scopes keep their own ids", async () => {
  const run = (id: string, wait: number) => runWithRequestContext({ requestId: id }, async () => {
    await delay(wait);
    return currentRequestId();
  });
  assert.deepEqual(await Promise.all([run("a", 5), run("b", 1)]), ["a", "b"]);
});
