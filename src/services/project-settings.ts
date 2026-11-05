import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { projectSettings } from "../db/schema.js";

export const AGENT_DEFAULT_HARNESS_KEY = "agent-default-harness";
export const AGENT_DEFAULT_MODEL_KEY = "agent-default-model";

export async function getProjectSetting(
  projectId: string,
  key: string,
): Promise<string | undefined> {
  const [row] = await db
    .select()
    .from(projectSettings)
    .where(and(eq(projectSettings.projectId, projectId), eq(projectSettings.key, key)))
    .limit(1);
  return row?.value?.trim() || undefined;
}

export async function setProjectSetting(
  projectId: string,
  key: string,
  value: string,
): Promise<string> {
  const trimmed = value.trim();
  await db
    .insert(projectSettings)
    .values({ projectId, key, value: trimmed })
    .onConflictDoUpdate({
      target: [projectSettings.projectId, projectSettings.key],
      set: { value: trimmed },
    });
  return trimmed;
}
