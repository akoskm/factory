export const TASK_QUEUE = "factory";

export interface WorkItemWorkflowInput {
  workItemId: string;
  projectId: string;
  sourceId: string;
  externalId: string;
  /** Resume at this agent instead of foreman (recovery). */
  startAgent?: string;
  /** Stored work-item phase. `ship` and `on_complete` skip the agent loop. */
  phase?: "step" | "ship" | "integrate" | "recheck" | "on_complete";
  integrateAttempts?: number;
  revisionLoops?: number;
  /** Re-enter the human wait instead of running the next step. */
  hold?: "waiting_review" | "needs_user";
  holdError?: string;
}

export interface LearnWorkflowInput {
  workItemId: string;
  projectId: string;
  sourceId: string;
}

export type ReviewSignal = {
  decision: "approve" | "request_changes";
  note?: string;
};

export interface AgentDecision {
  action: "spawn" | "complete" | "fail";
  agent?: string;
  note?: string;
}

export interface AgentActivityResult {
  runId: string;
  transcript: string;
  decision?: AgentDecision | null;
  reviewVerdict?: "accept" | "revise";
  verifyVerdict?: "accept" | "fail";
  status: "finished" | "error";
  error?: string;
}
