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
  /** Distinguishes needs_user Inbox holds (ask_user | bootstrap | proof). */
  holdKind?: "ask_user" | "bootstrap" | "proof";
}

export interface LearnWorkflowInput {
  workItemId: string;
  projectId: string;
  sourceId: string;
}

export type ReviewDecision = "approve" | "request_changes" | "close_pr";

export type ReviewSignal = {
  decision: ReviewDecision;
  note?: string;
};

export interface AgentDecision {
  action: "spawn" | "complete" | "fail" | "ask_user";
  agent?: string;
  note?: string;
  /** Structured choices for ask_user — UI renders one button per entry. */
  options?: string[];
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
