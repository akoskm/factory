import type { PipelineConfig } from "../config/load.js";
import type { AgentDecision } from "./shared.js";

export type AgentResultSummary = {
  decision?: AgentDecision | null;
  reviewVerdict?: "accept" | "revise";
  verifyVerdict?: "accept" | "fail";
};

export type NextStep =
  | { kind: "spawn"; agent: string; revisionLoops: number }
  | { kind: "complete" }
  | { kind: "fail"; note: string };

export function nextStep(input: {
  pipeline: PipelineConfig;
  agentName: string;
  result: AgentResultSummary;
  revisionLoops: number;
}): NextStep {
  const { pipeline, agentName, result, revisionLoops } = input;
  const defaultAgent = pipeline.routes.default ?? "foreman";

  if (agentName === "foreman") {
    const decision = result.decision;
    if (!decision || decision.action === "fail") {
      return { kind: "fail", note: decision?.note ?? "foreman failed" };
    }
    if (decision.action === "complete") {
      return { kind: "complete" };
    }
    if (decision.action === "spawn" && decision.agent) {
      return { kind: "spawn", agent: decision.agent, revisionLoops };
    }
    return { kind: "fail", note: "foreman returned no spawn target" };
  }

  if (agentName === "review") {
    const route = pipeline.routes.review ?? {};
    if (result.reviewVerdict === "revise" && revisionLoops < pipeline.revisionCap) {
      return {
        kind: "spawn",
        agent: route.revise ?? "implement",
        revisionLoops: revisionLoops + 1,
      };
    }
    return { kind: "spawn", agent: route.default ?? defaultAgent, revisionLoops };
  }

  if (agentName === "verify") {
    const route = pipeline.routes.verify ?? {};
    if (result.verifyVerdict === "fail") {
      return { kind: "fail", note: "verify failed" };
    }
    return { kind: "spawn", agent: route.default ?? defaultAgent, revisionLoops };
  }

  return { kind: "spawn", agent: defaultAgent, revisionLoops };
}
