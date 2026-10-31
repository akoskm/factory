import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "../db/index.js";
import { projects, workItems } from "../db/schema.js";
import { loadFactoryConfigAtSha } from "../config/resolve.js";
import { getTemporalClient, TASK_QUEUE } from "../temporal/client.js";

export async function runLearnNow(projectId: string): Promise<{
  workflowId: string;
  workItemId: string;
  externalId: string;
  agentName: string;
}> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw new Error("not found");

  const [item] = await db
    .select()
    .from(workItems)
    .where(and(eq(workItems.projectId, projectId), isNotNull(workItems.mergedAt)))
    .orderBy(desc(workItems.mergedAt))
    .limit(1);
  if (!item) throw new Error("No merged work item to learn from");
  if (item.status !== "completed") {
    throw new Error(`work item #${item.externalId} is ${item.status}`);
  }

  const { config } = await loadFactoryConfigAtSha({
    sha: item.configSha,
    sourceId: item.sourceId,
  });
  const agentName = config.pipeline.learnAgent;
  const workflowId = `learn-${item.id}-${Date.now()}`;
  const client = await getTemporalClient();
  await client.workflow.start("learnWorkflow", {
    taskQueue: TASK_QUEUE,
    workflowId,
    args: [
      {
        workItemId: item.id,
        projectId: item.projectId,
        sourceId: item.sourceId,
      },
    ],
  });

  return { workflowId, workItemId: item.id, externalId: item.externalId, agentName };
}
