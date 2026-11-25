import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import postgres from "postgres";
import { db } from "../db/index.js";
import { projects, workItems } from "../db/schema.js";
import { startWorkItemWorkflow, type StartWorkflowInput } from "./start-work-item-workflow.js";

/** Distinct advisory lock from intake. */
const DISPATCH_LOCK_KEY = 874_210_032;

const ACTIVE_STATUSES = ["running", "waiting_review", "needs_user"] as const;

export type DispatcherWorkItem = {
  id: string;
  projectId: string;
  sourceId: string;
  externalId: string;
  workflowId: string;
  status: string;
  queuedAt: Date | null;
  scheduledFor: Date | null;
};

export type DispatcherDeps = {
  now(): Date;
  listProjects(): Promise<{ id: string; maxConcurrentRuns: number }[]>;
  promoteDueScheduled(now: Date): Promise<number>;
  countActive(projectId: string): Promise<number>;
  listQueued(projectId: string): Promise<DispatcherWorkItem[]>;
  startWorkItemWorkflow(input: StartWorkflowInput): Promise<void>;
};

export type DispatcherPassResult = {
  promoted: number;
  started: number;
};

export async function runDispatcherPass(deps: DispatcherDeps): Promise<DispatcherPassResult> {
  const now = deps.now();
  const promoted = await deps.promoteDueScheduled(now);
  let started = 0;

  const allProjects = await deps.listProjects();
  for (const project of allProjects) {
    let active = await deps.countActive(project.id);
    const cap = Math.max(1, project.maxConcurrentRuns);
    if (active >= cap) continue;

    const queued = await deps.listQueued(project.id);
    for (const item of queued) {
      if (active >= cap) break;
      await deps.startWorkItemWorkflow({
        workItemId: item.id,
        projectId: item.projectId,
        sourceId: item.sourceId,
        externalId: item.externalId,
        workflowId: item.workflowId,
        markDispatched: true,
      });
      started += 1;
      active += 1;
    }
  }

  return { promoted, started };
}

export async function createDefaultDispatcherDeps(): Promise<DispatcherDeps> {
  return {
    now: () => new Date(),

    async listProjects() {
      const rows = await db
        .select({ id: projects.id, maxConcurrentRuns: projects.maxConcurrentRuns })
        .from(projects);
      return rows;
    },

    async promoteDueScheduled(now) {
      const rows = await db
        .update(workItems)
        .set({
          status: "queued",
          queuedAt: now,
          scheduledFor: null,
        })
        .where(
          and(
            eq(workItems.status, "scheduled"),
            lte(workItems.scheduledFor, now),
          ),
        )
        .returning({ id: workItems.id });
      return rows.length;
    },

    async countActive(projectId) {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(workItems)
        .where(
          and(
            eq(workItems.projectId, projectId),
            inArray(workItems.status, [...ACTIVE_STATUSES]),
          ),
        );
      return row?.n ?? 0;
    },

    async listQueued(projectId) {
      const rows = await db
        .select()
        .from(workItems)
        .where(and(eq(workItems.projectId, projectId), eq(workItems.status, "queued")))
        .orderBy(asc(workItems.queuedAt), asc(workItems.id));
      return rows.map((row) => ({
        id: row.id,
        projectId: row.projectId,
        sourceId: row.sourceId,
        externalId: row.externalId,
        workflowId: row.workflowId,
        status: row.status,
        queuedAt: row.queuedAt,
        scheduledFor: row.scheduledFor,
      }));
    },

    startWorkItemWorkflow,
  };
}

let lockSql: ReturnType<typeof postgres> | null = null;

function getLockSql() {
  if (!lockSql) {
    const url =
      process.env.DATABASE_URL ?? "postgres://factory:factory@localhost:5432/factory";
    lockSql = postgres(url, { max: 1 });
  }
  return lockSql;
}

export async function runDefaultDispatcherPass(): Promise<DispatcherPassResult> {
  const sqlClient = getLockSql();
  const [row] = await sqlClient`select pg_try_advisory_lock(${DISPATCH_LOCK_KEY}) as ok`;
  if (!row?.ok) {
    return { promoted: 0, started: 0 };
  }
  try {
    return await runDispatcherPass(await createDefaultDispatcherDeps());
  } finally {
    await sqlClient`select pg_advisory_unlock(${DISPATCH_LOCK_KEY})`;
  }
}

/** Run dispatcher for one project only (queue_and_start). */
export async function runDispatcherPassForProject(projectId: string): Promise<DispatcherPassResult> {
  const base = await createDefaultDispatcherDeps();
  return runDispatcherPass({
    ...base,
    listProjects: async () => {
      const all = await base.listProjects();
      return all.filter((p) => p.id === projectId);
    },
  });
}
