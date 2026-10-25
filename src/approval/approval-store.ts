import { z } from "zod";
import { resolveIncidentInputSchema } from "../domain/domain.ts";
import { routeSchema } from "../graph/routes.ts";

export const APPROVAL_TTL_MS = 15 * 60_000;

export const approvalIdSchema = z.uuid();
export const approvalStatusSchema = z.enum(["pending", "approved", "denied", "expired"]);
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;

export const approvalSchema = z.object({
  id: approvalIdSchema,
  requestId: z.uuid(),
  conversationId: z.string().min(1),
  tool: z.literal("resolve_incident"),
  args: resolveIncidentInputSchema,
  target: z.string().min(1),
  description: z.string().min(1),
  status: approvalStatusSchema,
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().nullable(),
}).strict().refine(
  (approval) => (approval.decidedAt !== null) === (approval.status === "approved" || approval.status === "denied"),
  { message: "decidedAt is set only for decided approvals." },
);
export type Approval = z.infer<typeof approvalSchema>;

/** Paused-turn facts the decision needs to finish the turn and record it. */
export const newApprovalSchema = z.object({
  id: approvalIdSchema,
  requestId: z.uuid(),
  conversationId: z.string().min(1),
  tool: z.literal("resolve_incident"),
  args: resolveIncidentInputSchema,
  target: z.string().min(1),
  description: z.string().min(1),
  route: routeSchema.nullable(),
  modelUsed: z.string().min(1).nullable(),
}).strict();
export type NewApproval = z.infer<typeof newApprovalSchema>;

export interface StoredApproval {
  readonly approval: Approval;
  readonly route: NewApproval["route"];
  readonly modelUsed: string | null;
}

export type ClaimResult =
  | { ok: true; stored: StoredApproval }
  | { ok: false; reason: "unknown" | "not_pending" };

export interface ApprovalStore {
  /** Saves a pending approval that expires APPROVAL_TTL_MS after `now`. */
  create(input: NewApproval, now: Date): StoredApproval;
  /** Throws DomainValidationError on a malformed id. A stale pending row reads as `expired`. */
  get(id: string, now: Date): StoredApproval | undefined;
  /** First decision wins: only a pending, unexpired row can be claimed. */
  claim(id: string, decision: "approved" | "denied", decisionRequestId: string, now: Date): ClaimResult;
  close(): void;
}
