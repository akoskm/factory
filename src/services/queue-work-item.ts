import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { workItems } from "../db/schema.js";
import { runDispatcherPassForProject } from "./queue-dispatcher.js";

export type QueueMode = "queue" | "queue_and_start" | "schedule";

export type QueueWorkItemInput = {
  mode: QueueMode;
  scheduledFor?: string | Date;
};

export type QueueWorkItemResult = {
  id: string;
  status: string;
  queuedAt: Date | null;
  scheduledFor: Date | null;
};

const QUEUEABLE = new Set(["listed", "scheduled"]);

export async function queueWorkItem(
  workItemId: string,
  input: QueueWorkItemInput,
): Promise<QueueWorkItemResult> {
  const [item] = await db.select().from(workItems).where(eq(workItems.id, workItemId)).limit(1);
  if (!item) throw new Error("not found");
  if (!QUEUEABLE.has(item.status)) {
    throw new Error(`can only queue listed/scheduled items (status=${item.status})`);
  }

  if (input.mode === "schedule") {
    if (input.scheduledFor == null || input.scheduledFor === "") {
      throw new Error("scheduledFor required");
    }
    const when = new Date(input.scheduledFor);
    if (!Number.isFinite(when.getTime())) throw new Error("scheduledFor invalid");
    if (when.getTime() <= Date.now()) throw new Error("scheduledFor must be in the future");

    const [updated] = await db
      .update(workItems)
      .set({
        status: "scheduled",
        scheduledFor: when,
        queuedAt: null,
      })
      .where(eq(workItems.id, workItemId))
      .returning();
    return {
      id: updated.id,
      status: updated.status,
      queuedAt: updated.queuedAt,
      scheduledFor: updated.scheduledFor,
    };
  }

  const now = new Date();
  const [updated] = await db
    .update(workItems)
    .set({
      status: "queued",
      queuedAt: now,
      scheduledFor: null,
    })
    .where(eq(workItems.id, workItemId))
    .returning();

  if (input.mode === "queue_and_start") {
    await runDispatcherPassForProject(updated.projectId);
  }

  return {
    id: updated.id,
    status: updated.status,
    queuedAt: updated.queuedAt,
    scheduledFor: updated.scheduledFor,
  };
}

/** Pure helper for acceptance tests — mutate in-memory item. */
export function applyQueueAction<
  T extends {
    status: string;
    queuedAt: Date | null;
    scheduledFor: Date | null;
  },
>(
  item: T,
  input: QueueWorkItemInput,
  now: Date = new Date(),
): T {
  if (!QUEUEABLE.has(item.status)) {
    throw new Error(`can only queue listed/scheduled items (status=${item.status})`);
  }
  if (input.mode === "schedule") {
    if (input.scheduledFor == null || input.scheduledFor === "") {
      throw new Error("scheduledFor required");
    }
    const when = new Date(input.scheduledFor);
    if (!Number.isFinite(when.getTime())) throw new Error("scheduledFor invalid");
    if (when.getTime() <= now.getTime()) throw new Error("scheduledFor must be in the future");
    return { ...item, status: "scheduled", scheduledFor: when, queuedAt: null };
  }
  return { ...item, status: "queued", queuedAt: now, scheduledFor: null };
}

const DEQUEUEABLE = new Set(["queued", "scheduled"]);

/** Pull off the backlog before the dispatcher starts it → listed again. */
export async function dequeueWorkItem(workItemId: string): Promise<QueueWorkItemResult> {
  const [item] = await db.select().from(workItems).where(eq(workItems.id, workItemId)).limit(1);
  if (!item) throw new Error("not found");
  if (!DEQUEUEABLE.has(item.status)) {
    throw new Error(`can only dequeue queued/scheduled items (status=${item.status})`);
  }

  const [updated] = await db
    .update(workItems)
    .set({
      status: "listed",
      queuedAt: null,
      scheduledFor: null,
    })
    .where(eq(workItems.id, workItemId))
    .returning();

  return {
    id: updated.id,
    status: updated.status,
    queuedAt: updated.queuedAt,
    scheduledFor: updated.scheduledFor,
  };
}

export function applyDequeueAction<
  T extends {
    status: string;
    queuedAt: Date | null;
    scheduledFor: Date | null;
  },
>(item: T): T {
  if (!DEQUEUEABLE.has(item.status)) {
    throw new Error(`can only dequeue queued/scheduled items (status=${item.status})`);
  }
  return { ...item, status: "listed", queuedAt: null, scheduledFor: null };
}
