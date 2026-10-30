import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { agents } from "../db/schema.js";
import { agentsDir, loadAgentsFromDir } from "../agents/loader.js";

export async function syncAgentsForProject(projectId: string): Promise<number> {
  const defs = await loadAgentsFromDir(agentsDir());
  let count = 0;
  for (const def of defs) {
    const existing = await db
      .select()
      .from(agents)
      .where(eq(agents.projectId, projectId));
    const row = existing.find((a) => a.name === def.name);
    if (row) {
      await db
        .update(agents)
        .set({
          agentType: def.agentType,
          description: def.description,
          harness: def.harness,
          model: def.model,
          spawnableBy: def.spawnableBy,
          instructions: def.instructions,
          idleTimeoutMinutes: def.idleTimeoutMinutes,
        })
        .where(eq(agents.id, row.id));
    } else {
      await db.insert(agents).values({
        projectId,
        name: def.name,
        agentType: def.agentType,
        description: def.description,
        harness: def.harness,
        model: def.model,
        spawnableBy: def.spawnableBy,
        instructions: def.instructions,
        idleTimeoutMinutes: def.idleTimeoutMinutes,
        waitForReview: false,
      });
    }
    count += 1;
  }
  return count;
}
