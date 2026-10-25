import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  readonly requestId: string;
}

// The router, graph and model factory are shared across requests, so the current request id
// travels with the async context instead of through every function signature.
const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}
