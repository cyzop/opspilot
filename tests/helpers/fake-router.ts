import type { Route, Router } from "../../src/graph/router.ts";

export type FakeRouterBehavior = Route | ((input: string) => unknown);

export function createFakeRouter(behavior: FakeRouterBehavior = "react") {
  const calls: string[] = [];
  const router: Router = async (input) => {
    calls.push(input);
    const output = typeof behavior === "function" ? behavior(input) : { route: behavior, reason: "fake router" };
    if (output instanceof Error) throw output;
    return output;
  };
  return { router, calls };
}
