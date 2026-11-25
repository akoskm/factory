import { WorkflowExecutionAlreadyStartedError } from "@temporalio/client";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { workItems } from "../db/schema.js";
import { getTemporalClient, TASK_QUEUE } from "../temporal/client.js";

export type StartWorkflowInput = {
  workItemId: string;
  projectId: string;
  sourceId: string;
  externalId: string;
  workflowId: string;
  startAgent?: string;
  phase?: string;
  integrateAttempts?: number;
  revisionLoops?: number;
  hold?: "waiting_review" | "needs_user";
  holdError?: string;
  /** Dispatcher: mark kickoff + running after start. */
  markDispatched?: boolean;
};

export async function startWorkItemWorkflow(input: StartWorkflowInput): Promise<void> {
  const client = await getTemporalClient();
  const args = [
    {
      workItemId: input.workItemId,
      projectId: input.projectId,
      sourceId: input.sourceId,
      externalId: input.externalId,
      ...(input.startAgent ? { startAgent: input.startAgent } : {}),
      ...(input.phase ? { phase: input.phase } : {}),
      ...(input.integrateAttempts != null ? { integrateAttempts: input.integrateAttempts } : {}),
      ...(input.revisionLoops != null ? { revisionLoops: input.revisionLoops } : {}),
      ...(input.hold ? { hold: input.hold, holdError: input.holdError } : {}),
    },
  ];

  const mark = async (workflowId: string) => {
    if (input.markDispatched && !input.hold) {
      await db
        .update(workItems)
        .set({ workflowId, kickoffAt: new Date(), status: "running" })
        .where(eq(workItems.id, input.workItemId));
      return;
    }
    if (workflowId !== input.workflowId) {
      await db
        .update(workItems)
        .set({
          workflowId,
          ...(input.hold ? {} : { status: "queued" }),
        })
        .where(eq(workItems.id, input.workItemId));
    }
  };

  try {
    await client.workflow.start("workItemWorkflow", {
      taskQueue: TASK_QUEUE,
      workflowId: input.workflowId,
      args,
    });
    if (input.markDispatched) await mark(input.workflowId);
  } catch (err) {
    if (!(err instanceof WorkflowExecutionAlreadyStartedError)) throw err;
    const workflowId = `${input.workflowId.replace(/-r\d+$/, "")}-r${Date.now()}`;
    await mark(workflowId);
    await client.workflow.start("workItemWorkflow", {
      taskQueue: TASK_QUEUE,
      workflowId,
      args,
    });
  }
}
