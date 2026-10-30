import { readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { loadAgentsFromDir, type AgentDefinition } from "../agents/loader.js";

export type PipelineConfig = {
  maxSteps: number;
  startAgent: string;
  revisionCap: number;
  workspaceAgents: string[];
  pushAgents: string[];
  learnAgent: string;
  routes: {
    review?: { revise?: string; default?: string };
    verify?: { fail?: string; default?: string };
    default?: string;
  };
  onComplete: string[];
};

export type FactoryConfig = {
  pipeline: PipelineConfig;
  agents: AgentDefinition[];
  dir: string;
};

function asStringArray(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) ? value.map(String) : fallback;
}

export function parsePipeline(raw: string): PipelineConfig {
  const data = (YAML.parse(raw) ?? {}) as Record<string, unknown>;
  const routes = (data.routes ?? {}) as PipelineConfig["routes"];
  return {
    maxSteps: Number(data.maxSteps ?? 40),
    startAgent: String(data.startAgent ?? "foreman"),
    revisionCap: Number(data.revisionCap ?? 2),
    workspaceAgents: asStringArray(data.workspaceAgents, [
      "triage",
      "spec",
      "implement",
      "review",
      "verify",
      "monitor",
    ]),
    pushAgents: asStringArray(data.pushAgents, ["implement", "verify"]),
    learnAgent: String(data.learnAgent ?? "monitor"),
    routes: {
      review: routes.review,
      verify: routes.verify,
      default: routes.default ?? "foreman",
    },
    onComplete: asStringArray(data.onComplete, ["mergeProduct", "monitor"]),
  };
}

export async function loadConfig(dir: string): Promise<FactoryConfig> {
  const pipelinePath = path.join(dir, "pipeline.yaml");
  let pipelineRaw: string;
  try {
    pipelineRaw = await readFile(pipelinePath, "utf8");
  } catch {
    throw new Error(`config repo missing pipeline.yaml at ${pipelinePath}`);
  }
  const agentsDir = path.join(dir, "agents");
  const agents = await loadAgentsFromDir(agentsDir);
  if (!agents.length) {
    throw new Error("config repo has no agents");
  }
  return {
    pipeline: parsePipeline(pipelineRaw),
    agents,
    dir,
  };
}

export function findAgent(config: FactoryConfig, name: string): AgentDefinition | undefined {
  return config.agents.find((a) => a.name === name);
}
