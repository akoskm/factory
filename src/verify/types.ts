export type ProofFileMeta = {
  filename: string;
  mimeType: string;
  title?: string;
  size: number;
};

export type VerifyProofArtifact = {
  sha: string;
  scenario: string;
  summary: string;
  requiresHumanReview: boolean;
  workflowRunId?: number;
  workflowRunUrl?: string;
  files: ProofFileMeta[];
  provedAt: string;
};

export type ProofSidecar = {
  runsOn: string | string[];
  requiredSecrets?: string[];
};

export type PlanVerifyResult =
  | { kind: "skip"; reason: string; verifyVerdict: "accept" }
  | { kind: "reuse"; artifact: VerifyProofArtifact; verifyVerdict: "accept" | "fail" }
  | { kind: "run"; sha: string; scenario: string; workflow: string }
  | { kind: "hold"; holdKind: "bootstrap"; note: string };

export type EnsureWorkflowResult =
  | { kind: "ready"; workflow: string }
  | { kind: "hold"; holdKind: "bootstrap"; note: string; setupPrUrl?: string }
  | { kind: "waiting"; note: string; setupPrUrl?: string };

export type DispatchProofResult =
  | { kind: "started"; runId: number; runUrl: string }
  | { kind: "hold"; holdKind: "bootstrap"; note: string };

export type PollProofResult =
  | { kind: "running" }
  | { kind: "success"; runId: number; runUrl: string }
  | { kind: "failure"; runId: number; runUrl: string; note: string }
  | { kind: "timeout"; note: string };

export type FinalizeProofResult = {
  verifyVerdict: "accept" | "fail";
  requiresHumanReview: boolean;
  artifact: VerifyProofArtifact;
  transcript: string;
};
