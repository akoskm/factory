export const TASK_QUEUE = "factory";

export interface WorkItemWorkflowInput {
  workItemId: string;
  projectId: string;
  sourceId: string;
  externalId: string;
  /** Resume at this agent instead of foreman (recovery). */
  startAgent?: string;
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
