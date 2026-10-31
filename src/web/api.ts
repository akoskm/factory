import type { PipelineView } from "./pipeline-graph";

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    let message = text || res.statusText;
    try {
      const json = JSON.parse(text) as { error?: string };
      if (json.error) message = json.error;
    } catch {
      // keep raw text
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export type Project = {
  id: string;
  name: string;
  slug: string;
  repoUrl: string;
  defaultBranch: string;
};

export type WorkItem = {
  id: string;
  title: string;
  status: string;
  currentAgent: string | null;
  waitingForReview: boolean;
  url: string;
  prUrl: string | null;
  workflowId: string;
  kickoffAt: string;
  error: string | null;
};

export type HarnessModelsResponse = {
  harness: string;
  models: string[];
  error?: string;
};

export type ConfigAgent = {
  name: string;
  agentType: string;
  description: string;
  harness: string;
  model: string;
  waitForReview: boolean;
  spawnableBy: string[];
  idleTimeoutMinutes: number;
  instructions: string;
};

export type ConfigAgentsResponse = {
  configSha: string;
  configRepo: string;
  agents: ConfigAgent[];
  pipeline: PipelineView;
  pipelineYaml: string;
  learnAgent: string;
  learnAgentFileUrl: string | null;
};

export type WorkItemArtifact = {
  id: string;
  kind: string;
  content: string;
  runId?: string | null;
  updatedAt: string;
};

export type Metrics = {
  cycleTime: {
    kickoffToPrMs: number | null;
    prToFirstReviewMs: number | null;
    firstReviewToMergeMs: number | null;
    kickoffToMergeMs: number | null;
  };
  pullRequests: { opened: number; merged: number };
  runsByAgent: { agentName: string; count: number; cost: string }[];
  totalCostUsd: number;
};

export function fmtDuration(ms: number | null): string {
  if (ms == null) return "—";
  const h = ms / 3_600_000;
  if (h >= 1) return `${h.toFixed(1)}h`;
  const m = ms / 60_000;
  if (m >= 1) return `${m.toFixed(1)}m`;
  return `${Math.round(ms / 1000)}s`;
}
