import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { agents, instanceAgentDefaults } from "../db/schema.js";

export const KNOWN_AGENT_NAMES = [
  "foreman",
  "triage",
  "spec",
  "implement",
  "review",
  "verify",
  "monitor",
] as const;

export async function ensureInstanceAgentDefaults(): Promise<void> {
  for (const agentName of KNOWN_AGENT_NAMES) {
    await db
      .insert(instanceAgentDefaults)
      .values({ agentName, waitForReview: false })
      .onConflictDoNothing();
  }
}

export async function listInstanceAgentDefaults() {
  await ensureInstanceAgentDefaults();
  return db.select().from(instanceAgentDefaults).orderBy(instanceAgentDefaults.agentName);
}

export async function resolveWaitForReview(
  projectId: string,
  agentName: string,
): Promise<boolean> {
  const projectRows = await db.select().from(agents).where(eq(agents.projectId, projectId));
  const project = projectRows.find((a) => a.name === agentName);
  if (project?.waitForReview != null) return project.waitForReview;

  await ensureInstanceAgentDefaults();
  const [def] = await db
    .select()
    .from(instanceAgentDefaults)
    .where(eq(instanceAgentDefaults.agentName, agentName))
    .limit(1);
  return def?.waitForReview ?? false;
}

export async function agentsWithEffectiveWait(projectId: string) {
  const defaults = await listInstanceAgentDefaults();
  const defaultMap = new Map(defaults.map((d) => [d.agentName, d.waitForReview]));
  const rows = await db
    .select()
    .from(agents)
    .where(eq(agents.projectId, projectId))
    .orderBy(agents.name);
  return rows.map((row) => {
    const instanceDefault = defaultMap.get(row.name) ?? false;
    const effectiveWaitForReview = row.waitForReview ?? instanceDefault;
    return {
      ...row,
      instanceDefault,
      effectiveWaitForReview,
    };
  });
}
