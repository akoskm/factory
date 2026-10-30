import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

export type AgentType =
  | "FOREMAN"
  | "TRIAGE"
  | "SPEC"
  | "IMPLEMENT"
  | "REVIEW"
  | "VERIFY"
  | "CUSTOM";

export type HarnessName = "cursor" | "claude-code";

export interface AgentDefinition {
  name: string;
  description: string;
  agentType: AgentType;
  spawnableBy: string[];
  harness: HarnessName;
  model: string;
  idleTimeoutMinutes: number;
  instructions: string;
  filePath: string;
}

function parseFrontmatter(raw: string): { data: Record<string, unknown>; body: string } {
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
      harness: (String(data.harness ?? "cursor") as HarnessName),
      model: String(data.model ?? "composer-2"),
      idleTimeoutMinutes: Number(data.idleTimeoutMinutes ?? 10),
      instructions: body,
      filePath,
    });
  }

  return agents;
}

export function agentsDir(): string {
  return process.env.AGENTS_DIR ?? path.resolve(process.cwd(), "agents");
}
