import { and, asc, desc, eq, gt, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { projects, workItemInboxState, workItems } from "../db/schema.js";

export type InboxFilter = "active" | "snoozed" | "completed";

export type InboxItem = {
  id: string;
  projectId: string;
  projectName: string;
  title: string;
  status: string;
  currentAgent: string | null;
  phase: string;
  url: string;
  prUrl: string | null;
  error: string | null;
  takenOver: boolean;
  blockedAt: string;
  snoozedUntil: string | null;
  dismissedAt: string | null;
};

function takenOver(metadata: Record<string, unknown> | null | undefined): boolean {
  return Boolean(metadata && metadata.takenOver === true);
}

/** Start or refresh an Active inbox episode when status becomes needs_user. */
export async function syncInboxOnStatus(
  workItemId: string,
  status: string,
): Promise<void> {
  const now = new Date();
  const [existing] = await db
    .select()
    .from(workItemInboxState)
    .where(eq(workItemInboxState.workItemId, workItemId))
    .limit(1);

  if (status === "needs_user") {
    if (!existing || existing.dismissedAt != null) {
      await db
        .insert(workItemInboxState)
        .values({
          workItemId,
          blockedAt: now,
          snoozedUntil: null,
          dismissedAt: null,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: workItemInboxState.workItemId,
          set: {
            blockedAt: now,
            snoozedUntil: null,
            dismissedAt: null,
            updatedAt: now,
          },
        });
    }
    return;
  }

  if (existing && existing.dismissedAt == null) {
    await db
      .update(workItemInboxState)
      .set({ dismissedAt: now, snoozedUntil: null, updatedAt: now })
      .where(eq(workItemInboxState.workItemId, workItemId));
  }
}

export async function snoozeInboxItem(
  workItemId: string,
  until: Date,
): Promise<void> {
  if (Number.isNaN(until.getTime()) || until.getTime() <= Date.now()) {
    throw new Error("snooze until must be a future time");
  }
  const [item] = await db.select().from(workItems).where(eq(workItems.id, workItemId)).limit(1);
  if (!item) throw new Error("not found");
  if (item.status !== "needs_user") {
    throw new Error("can only snooze needs_user items");
  }

  const now = new Date();
  const [existing] = await db
    .select()
    .from(workItemInboxState)
    .where(eq(workItemInboxState.workItemId, workItemId))
    .limit(1);

  if (!existing || existing.dismissedAt != null) {
    await db
      .insert(workItemInboxState)
      .values({
        workItemId,
        blockedAt: existing?.blockedAt ?? now,
        snoozedUntil: until,
        dismissedAt: null,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: workItemInboxState.workItemId,
        set: {
          snoozedUntil: until,
          dismissedAt: null,
          updatedAt: now,
          blockedAt: existing?.blockedAt ?? now,
        },
      });
    return;
  }

  await db
    .update(workItemInboxState)
    .set({ snoozedUntil: until, updatedAt: now })
    .where(eq(workItemInboxState.workItemId, workItemId));
}

export async function unsnoozeInboxItem(workItemId: string): Promise<void> {
  const [existing] = await db
    .select()
    .from(workItemInboxState)
    .where(eq(workItemInboxState.workItemId, workItemId))
    .limit(1);
  if (!existing) throw new Error("not found");
  await db
    .update(workItemInboxState)
    .set({ snoozedUntil: null, updatedAt: new Date() })
    .where(eq(workItemInboxState.workItemId, workItemId));
}

export async function countActiveInbox(projectId?: string): Promise<number> {
  const now = new Date();
  const conditions = [
    eq(workItems.status, "needs_user"),
    isNull(workItemInboxState.dismissedAt),
    or(isNull(workItemInboxState.snoozedUntil), lte(workItemInboxState.snoozedUntil, now)),
  ];
  if (projectId) conditions.push(eq(workItems.projectId, projectId));

  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(workItems)
    .innerJoin(workItemInboxState, eq(workItemInboxState.workItemId, workItems.id))
    .where(and(...conditions));
  return row?.count ?? 0;
}

/** Backfill inbox rows for needs_user items that never got a sync (orphans). */
async function ensureInboxRowsForNeedsUser(): Promise<void> {
  const orphans = await db
    .select({ id: workItems.id })
    .from(workItems)
    .leftJoin(workItemInboxState, eq(workItemInboxState.workItemId, workItems.id))
    .where(and(eq(workItems.status, "needs_user"), isNull(workItemInboxState.workItemId)));
  const now = new Date();
  for (const row of orphans) {
    await db
      .insert(workItemInboxState)
      .values({
        workItemId: row.id,
        blockedAt: now,
        snoozedUntil: null,
        dismissedAt: null,
        updatedAt: now,
      })
      .onConflictDoNothing();
  }
}

export async function listInbox(input: {
  filter: InboxFilter;
  projectId?: string;
}): Promise<{ items: InboxItem[]; activeCount: number }> {
  const now = new Date();
  if (input.filter === "active" || input.filter === "snoozed") {
    await ensureInboxRowsForNeedsUser();
  }
  const activeCount = await countActiveInbox(input.projectId);

  if (input.filter === "completed") {
    const conditions = [isNotNull(workItemInboxState.dismissedAt)];
    if (input.projectId) conditions.push(eq(workItems.projectId, input.projectId));
    const rows = await db
      .select({
        item: workItems,
        projectName: projects.name,
        inbox: workItemInboxState,
      })
      .from(workItemInboxState)
      .innerJoin(workItems, eq(workItems.id, workItemInboxState.workItemId))
      .innerJoin(projects, eq(projects.id, workItems.projectId))
      .where(and(...conditions))
      .orderBy(desc(workItemInboxState.dismissedAt));
    return {
      activeCount,
      items: rows.map((r) => mapRow(r.item, r.projectName, r.inbox)),
    };
  }

  if (input.filter === "snoozed") {
    const conditions = [
      eq(workItems.status, "needs_user"),
      isNull(workItemInboxState.dismissedAt),
      isNotNull(workItemInboxState.snoozedUntil),
      gt(workItemInboxState.snoozedUntil, now),
    ];
    if (input.projectId) conditions.push(eq(workItems.projectId, input.projectId));
    const rows = await db
      .select({
        item: workItems,
        projectName: projects.name,
        inbox: workItemInboxState,
      })
      .from(workItems)
      .innerJoin(workItemInboxState, eq(workItemInboxState.workItemId, workItems.id))
      .innerJoin(projects, eq(projects.id, workItems.projectId))
      .where(and(...conditions))
      .orderBy(asc(workItemInboxState.snoozedUntil));
    return {
      activeCount,
      items: rows.map((r) => mapRow(r.item, r.projectName, r.inbox)),
    };
  }

  // active
  const conditions = [
    eq(workItems.status, "needs_user"),
    isNull(workItemInboxState.dismissedAt),
    or(isNull(workItemInboxState.snoozedUntil), lte(workItemInboxState.snoozedUntil, now)),
  ];
  if (input.projectId) conditions.push(eq(workItems.projectId, input.projectId));
  const rows = await db
    .select({
      item: workItems,
      projectName: projects.name,
      inbox: workItemInboxState,
    })
    .from(workItems)
    .innerJoin(workItemInboxState, eq(workItemInboxState.workItemId, workItems.id))
    .innerJoin(projects, eq(projects.id, workItems.projectId))
    .where(and(...conditions))
    .orderBy(asc(workItemInboxState.blockedAt));
  return {
    activeCount,
    items: rows.map((r) => mapRow(r.item, r.projectName, r.inbox)),
  };
}

function mapRow(
  item: typeof workItems.$inferSelect,
  projectName: string,
  inbox: typeof workItemInboxState.$inferSelect,
): InboxItem {
  return {
    id: item.id,
    projectId: item.projectId,
    projectName,
    title: item.title,
    status: item.status,
    currentAgent: item.currentAgent,
    phase: item.phase,
    url: item.url,
    prUrl: item.prUrl,
    error: item.error,
    takenOver: takenOver(item.metadata),
    blockedAt: inbox.blockedAt.toISOString(),
    snoozedUntil: inbox.snoozedUntil?.toISOString() ?? null,
    dismissedAt: inbox.dismissedAt?.toISOString() ?? null,
  };
}

/** Pure helpers for unit tests. */
export function isActiveInboxRow(input: {
  status: string;
  dismissedAt: Date | null;
  snoozedUntil: Date | null;
  now: Date;
}): boolean {
  if (input.status !== "needs_user") return false;
  if (input.dismissedAt != null) return false;
  if (input.snoozedUntil != null && input.snoozedUntil.getTime() > input.now.getTime()) {
    return false;
  }
  return true;
}

export function shouldOpenInboxEpisode(input: {
  status: string;
  existing: { dismissedAt: Date | null } | null;
}): boolean {
  if (input.status !== "needs_user") return false;
  return !input.existing || input.existing.dismissedAt != null;
}

export function shouldArchiveInboxEpisode(input: {
  status: string;
  existing: { dismissedAt: Date | null } | null;
}): boolean {
  if (input.status === "needs_user") return false;
  return Boolean(input.existing && input.existing.dismissedAt == null);
}
