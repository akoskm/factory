import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { parseHarnessName, type HarnessName } from "../harnesses/types.js";

export type { HarnessName };

export type AgentType =
  | "FOREMAN"
  | "TRIAGE"
  | "SPEC"
  | "IMPLEMENT"
  | "REVIEW"
  | "VERIFY"
  | "CUSTOM";

export interface AgentDefinition {
  name: string;
  description: string;
  agentType: AgentType;
  spawnableBy: string[];
  harness: HarnessName;
  model: string;
  idleTimeoutMinutes: number;
  waitForReview: boolean;
  instructions: string;
  filePath: string;
}

export function parseFrontmatter(raw: string): { data: Record<string, unknown>; body: string } {
  if (!raw.startsWith("---")) {
    return { data: {}, body: raw.trim() };
  }
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { data: {}, body: raw.trim() };
  const fm = raw.slice(3, end).trim();
  const body = raw.slice(end + 4).trim();
  const data = (YAML.parse(fm) ?? {}) as Record<string, unknown>;
  return { data, body };
}

export async function loadAgentsFromDir(dir: string): Promise<AgentDefinition[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const agents: AgentDefinition[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const filePath = path.join(dir, entry.name, "agent.md");
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch {
      continue;
    }
    const { data, body } = parseFrontmatter(raw);
    const spawnableBy = Array.isArray(data.spawnableBy)
      ? data.spawnableBy.map(String)
      : data.spawnableBy == null
        ? ["foreman"]
        : [];
    agents.push({
      name: entry.name,
      description: String(data.description ?? ""),
      agentType: String(data.agentType ?? "CUSTOM").toUpperCase() as AgentType,
      spawnableBy,
      harness: parseHarnessName(data.harness),
      model: String(data.model ?? "composer-2"),
      idleTimeoutMinutes: Number(data.idleTimeoutMinutes ?? 10),
      waitForReview: Boolean(data.waitForReview),
      instructions: body,
      filePath,
    });
  }

  return agents;
}
