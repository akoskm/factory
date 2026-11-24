import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { secrets, sources, workItems } from "../db/schema.js";
import { decryptSecret } from "../crypto/secrets.js";
import { createGitHubSource } from "../connectors/github.js";
import { getTemporalClient, TASK_QUEUE } from "../temporal/client.js";
import { recoverStart, type RecoverAction } from "../work-item-phase.js";

export type { RecoverAction };

function nextWorkflowId(current: string): string {
  const base = current.replace(/-r\d+$/, "");
  return `${base}-r${Date.now()}`;
}

async function githubForSource(sourceId: string) {
  const [source] = await db.select().from(sources).where(eq(sources.id, sourceId)).limit(1);
  if (!source) throw new Error("source not found");
  let token = process.env.GITHUB_TOKEN ?? "";
  if (source.secretId) {
    const [sec] = await db.select().from(secrets).where(eq(secrets.id, source.secretId)).limit(1);
    if (sec) token = decryptSecret(sec.ciphertext);
  }
  if (!token) throw new Error("Missing GitHub token for source");
  return {
    source,
    github: createGitHubSource({
      owner: source.config.owner,
      repo: source.config.repo,
      label: source.config.label,
      token,
    }),
  };
}

export async function recoverWorkItem(
  workItemId: string,
  action: RecoverAction,
): Promise<{ ok: true; workflowId: string; startAgent: string }> {
  const [item] = await db.select().from(workItems).where(eq(workItems.id, workItemId)).limit(1);
  if (!item) throw new Error("not found");
  if (item.status !== "failed") {
    throw new Error(`can only recover failed work items (status=${item.status})`);
  }

  const resume = recoverStart({
    action,
    phase: item.phase,
    agent: item.currentAgent,
  });
  let startAgent = resume.startAgent;
  let phase = resume.phase;

  if (action === "reset_branch") {
    const { github } = await githubForSource(item.sourceId);
    if (item.prNumber) {
      try {
        await github.closePr(item.prNumber);
      } catch {
        // already closed
      }
    }
    if (item.branch) {
      await github.deleteBranch(item.branch);
    }
    await db
      .update(workItems)
      .set({
        branch: null,
        prNumber: null,
        prUrl: null,
        prOpenedAt: null,
      })
      .where(eq(workItems.id, item.id));
    startAgent = "foreman";
    phase = "step";
  }

  const client = await getTemporalClient();
  try {
    await client.workflow.getHandle(item.workflowId).terminate("recover restart");
  } catch {
    // already finished
  }

  const workflowId = nextWorkflowId(item.workflowId);
  await db
    .update(workItems)
    .set({
      workflowId,
      status: "queued",
      phase,
      integrateAttempts: phase === "step" ? 0 : item.integrateAttempts,
      revisionLoops: phase === "step" ? 0 : item.revisionLoops,
      error: null,
      waitingForReview: false,
      currentAgent: startAgent === "ship" ? null : startAgent,
    })
    .where(eq(workItems.id, item.id));

  await client.workflow.start("workItemWorkflow", {
    taskQueue: TASK_QUEUE,
    workflowId,
    args: [
      {
        workItemId: item.id,
        projectId: item.projectId,
        sourceId: item.sourceId,
        externalId: item.externalId,
        startAgent,
        phase,
        integrateAttempts: phase === "step" ? 0 : item.integrateAttempts,
        revisionLoops: phase === "step" ? 0 : item.revisionLoops,
      },
    ],
  });

  return { ok: true, workflowId, startAgent };
}
