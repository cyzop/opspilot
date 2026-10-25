import { AsyncLocalStorage } from "node:async_hooks";

export interface ApprovalPolicy {
  /** Tools that must not run without a human decision. */
  readonly gated: readonly string[];
}

/** Only `/chat` sets a policy; the CLI and the MCP server keep running tools directly. */
export const HTTP_APPROVAL_POLICY: ApprovalPolicy = { gated: ["resolve_incident"] };

const storage = new AsyncLocalStorage<ApprovalPolicy>();

export function runWithApprovalPolicy<T>(policy: ApprovalPolicy, fn: () => T): T {
  return storage.run(policy, fn);
}

export function approvalRequiredFor(tool: string): boolean {
  return storage.getStore()?.gated.includes(tool) ?? false;
}
