import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { runs, workItemChatSessions, workItems } from "../db/schema.js";
import { getTemporalClient } from "../temporal/client.js";

export type TakeOverResult = {
  ok: true;
  status: "needs_user_input";
  sessionId: string;
  takenOver: true;
};

async function ensureChatSession(workItemId: string): Promise<string> {
  const [existing] = await db
    .select()
    .from(workItemChatSessions)
    .where(eq(workItemChatSessions.workItemId, workItemId))
    .limit(1);
  if (existing) {
    if (existing.status !== "open") {
      await db
        .update(workItemChatSessions)
        .set({ status: "open", updatedAt: new Date() })
        .where(eq(workItemChatSessions.id, existing.id));
    }
    return existing.id;
  }
  const [created] = await db
    .insert(workItemChatSessions)
    .values({ workItemId, status: "open" })
    .returning();
  return created.id;
}

/** Hard-interrupt the Temporal workflow and park the item for steer chat. */
export async function takeOverWorkItem(workItemId: string): Promise<TakeOverResult> {
  const [item] = await db.select().from(workItems).where(eq(workItems.id, workItemId)).limit(1);
  if (!item) throw new Error("not found");
  if (item.status === "completed" || item.status === "merged") {
    throw new Error(`cannot take over ${item.status} work items`);
  }

  const client = await getTemporalClient();
  try {
    await client.workflow.getHandle(item.workflowId).terminate("user take over");
  } catch {
    // already finished / missing
  }

  await db
    .update(runs)
    .set({
      status: "error",
      error: "Taken over by user",
      finishedAt: new Date(),
    })
    .where(and(eq(runs.workItemId, item.id), eq(runs.status, "running")));

  const metadata = {
    ...(item.metadata ?? {}),
    takenOver: true,
  };

  await db
    .update(workItems)
    .set({
      status: "needs_user_input",
      waitingForReview: false,
      error: null,
      currentAgent: "foreman",
      metadata,
    })
    .where(eq(workItems.id, item.id));

  const sessionId = await ensureChatSession(item.id);
  return { ok: true, status: "needs_user_input", sessionId, takenOver: true };
}

/** Interrupt an in-flight agent. Skips `queued` to avoid racing a just-started continue. */
export async function interruptIfRunning(workItemId: string): Promise<void> {
  const [item] = await db.select().from(workItems).where(eq(workItems.id, workItemId)).limit(1);
  if (!item) throw new Error("not found");
  if (item.status !== "running" && item.status !== "waiting_review" && item.status !== "needs_user") {
    return;
  }

  const client = await getTemporalClient();
  try {
    await client.workflow.getHandle(item.workflowId).terminate("user steer interrupt");
  } catch {
    // already finished
  }

  await db
    .update(runs)
    .set({
      status: "error",
      error: "Interrupted by user steer",
      finishedAt: new Date(),
    })
    .where(and(eq(runs.workItemId, item.id), eq(runs.status, "running")));

  await db
    .update(workItems)
    .set({
      status: "needs_user_input",
      waitingForReview: false,
      currentAgent: "foreman",
    })
    .where(eq(workItems.id, item.id));
}
