/** Persisted phase for a work item. The workflow, intake, and recover all read this. */
export const WORK_PHASES = ["step", "ship", "integrate", "recheck", "on_complete"] as const;

export type WorkPhase = (typeof WORK_PHASES)[number];

export type RecoverAction = "retry_last" | "retry_foreman" | "reset_branch";

export type HoldStatus = "waiting_review" | "needs_user";

export type IntakeResume = {
  phase: WorkPhase;
  startAgent: string;
  hold?: HoldStatus;
};

export type ReviewSettlement =
  | { kind: "proceed" }
  | { kind: "continue" }
  | { kind: "revise"; note: string; revisionLoops: number }
  | { kind: "stop"; error: string };

export function parsePhase(value: string | null | undefined): WorkPhase {
  if (
    value === "ship" ||
    value === "integrate" ||
    value === "recheck" ||
    value === "on_complete"
  ) {
    return value;
  }
  return "step";
}

/** Hold statuses are the only ones that accept a review signal. */
export function isHoldStatus(status: string): boolean {
  return status === "waiting_review" || status === "needs_user";
}

/**
 * One table for the review signal.
 * `waiting_review` request_changes reruns the agent and counts toward the revision cap.
 * `needs_user` request_changes stops the item. Approve on that status resumes ship.
 */
export function settleReview(input: {
  status: "waiting_review" | "needs_user";
  decision: "approve" | "request_changes" | null;
  note?: string;
  fallbackNote: string;
  revisionLoops: number;
  revisionCap: number;
}): ReviewSettlement {
  if (!input.decision) return { kind: "stop", error: input.fallbackNote };
  if (input.status === "needs_user") {
    if (input.decision === "approve") return { kind: "continue" };
    return { kind: "stop", error: input.note?.trim() || input.fallbackNote };
  }
  if (input.decision === "approve") return { kind: "proceed" };
  if (input.revisionLoops >= input.revisionCap) {
    return { kind: "stop", error: "revision cap reached" };
  }
  return {
    kind: "revise",
    note: input.note?.trim() || "Please revise.",
    revisionLoops: input.revisionLoops + 1,
  };
}

/** Where retry_last / intake should start, from the stored phase. No error-text matching. */
export function recoverStart(input: {
  action: RecoverAction;
  phase: string | null | undefined;
  agent: string | null | undefined;
}): { phase: WorkPhase; startAgent: string } {
  if (input.action === "reset_branch" || input.action === "retry_foreman") {
    return { phase: "step", startAgent: "foreman" };
  }
  const phase = parsePhase(input.phase);
  if (phase === "on_complete") return { phase: "on_complete", startAgent: "ship" };
  if (phase === "ship") return { phase: "ship", startAgent: "ship" };
  if (phase === "integrate") return { phase: "integrate", startAgent: "implement" };
  if (phase === "recheck") return { phase: "recheck", startAgent: "verify" };
  return { phase: "step", startAgent: input.agent?.trim() || "foreman" };
}

/** Dead workflow restart. Merged rows finish the post-merge steps instead of starting over. */
export function intakeResume(item: {
  status?: string | null;
  phase?: string | null;
  currentAgent?: string | null;
}): IntakeResume {
  if (item.status === "needs_user") {
    return { phase: "ship", startAgent: "ship", hold: "needs_user" };
  }
  if (item.status === "waiting_review") {
    return {
      phase: parsePhase(item.phase),
      startAgent: item.currentAgent?.trim() || "foreman",
      hold: "waiting_review",
    };
  }
  const phase = parsePhase(item.phase);
  if (item.status === "merged" || phase === "on_complete") {
    return { phase: "on_complete", startAgent: "ship" };
  }
  return recoverStart({ action: "retry_last", phase, agent: item.currentAgent });
}
