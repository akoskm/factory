import {
  WorkflowExecutionAlreadyStartedError,
  WorkflowNotFoundError,
} from "@temporalio/client";
import { inArray, eq } from "drizzle-orm";
import postgres from "postgres";
import { createGitHubSource } from "../connectors/github.js";
import type { WorkItemInput } from "../connectors/types.js";
import { decryptSecret } from "../crypto/secrets.js";
import { db } from "../db/index.js";
import { secrets, sources, workItems } from "../db/schema.js";
import { getTemporalClient, TASK_QUEUE } from "../temporal/client.js";
import { intakeResume } from "../work-item-phase.js";

/** Stable int4 advisory lock id for intake (multi-replica single-flight). */
const INTAKE_LOCK_KEY = 874_210_031;

export type IntakeSource = {
  id: string;
  projectId: string;
  kind: string;
};

export type IntakeWorkItem = {
  id: string;
  projectId: string;
  sourceId: string;
  externalId: string;
  workflowId: string;
  status: string;
  phase?: string | null;
  currentAgent?: string | null;
  integrateAttempts?: number;
  revisionLoops?: number;
  error?: string | null;
};

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
};

/** Temporal workflow visibility for repair decisions. */
export type WorkflowPresence = "running" | "absent" | "terminal" | "unknown";

export type IntakeDeps = {
  listEnabledSources(): Promise<IntakeSource[]>;
  listReadyIssues(source: IntakeSource): Promise<WorkItemInput[]>;
  existingExternalIds(sourceId: string): Promise<Set<string>>;
  insertWorkItem(input: {
    projectId: string;
    sourceId: string;
    externalId: string;
    title: string;
    body: string;
    url: string;
    workflowId: string;
  }): Promise<IntakeWorkItem>;
  listOrphanCandidates(): Promise<IntakeWorkItem[]>;
  workflowPresence(workflowId: string): Promise<WorkflowPresence>;
  startWorkItemWorkflow(input: StartWorkflowInput): Promise<void>;
};

export type IntakePassResult = {
  started: number;
  repaired: number;
};

export function parseIntakeIntervalMs(
  raw: string | undefined,
  fallback = 30_000,
): number {
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function workflowIdFor(source: IntakeSource, externalId: string): string {
  return `wi-${source.projectId}-${source.id}-${externalId}`;
}

export async function runIntakePass(deps: IntakeDeps): Promise<IntakePassResult> {
  let started = 0;
  let repaired = 0;

  const allSources = await deps.listEnabledSources();
  for (const source of allSources) {
    if (source.kind !== "github") continue;
    try {
      const ready = await deps.listReadyIssues(source);
      const existing = await deps.existingExternalIds(source.id);
      for (const issue of ready) {
        if (existing.has(issue.externalId)) continue;
        const workflowId = workflowIdFor(source, issue.externalId);
        const item = await deps.insertWorkItem({
          projectId: source.projectId,
          sourceId: source.id,
          externalId: issue.externalId,
          title: issue.title,
          body: issue.body,
          url: issue.url,
          workflowId,
        });
        await deps.startWorkItemWorkflow({
          workItemId: item.id,
          projectId: item.projectId,
          sourceId: item.sourceId,
          externalId: item.externalId,
          workflowId: item.workflowId,
        });
        existing.add(issue.externalId);
        started += 1;
      }
    } catch (err) {
      console.error(`intake source ${source.id} failed`, err);
    }
  }

  const orphans = await deps.listOrphanCandidates();
  for (const item of orphans) {
    try {
      const presence = await deps.workflowPresence(item.workflowId);
      if (presence === "running" || presence === "unknown") continue;
      const resume = intakeResume(item);
      await deps.startWorkItemWorkflow({
        workItemId: item.id,
        projectId: item.projectId,
        sourceId: item.sourceId,
        externalId: item.externalId,
        workflowId: item.workflowId,
        startAgent: resume.startAgent,
        phase: resume.phase,
        integrateAttempts: item.integrateAttempts ?? 0,
        revisionLoops: item.revisionLoops ?? 0,
        hold: resume.hold,
        holdError: item.error ?? undefined,
      });
      repaired += 1;
    } catch (err) {
      console.error(`intake repair ${item.id} failed`, err);
    }
  }

  return { started, repaired };
}

async function resolveGithubToken(secretId: string | null): Promise<string> {
  let token = process.env.GITHUB_TOKEN ?? "";
  if (secretId) {
    const [sec] = await db.select().from(secrets).where(eq(secrets.id, secretId)).limit(1);
    if (sec) token = decryptSecret(sec.ciphertext);
  }
  return token;
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

export async function createDefaultIntakeDeps(): Promise<IntakeDeps> {
  const client = await getTemporalClient();

  return {
    async listEnabledSources() {
      const rows = await db.select().from(sources).where(eq(sources.enabled, true));
      return rows.map((row) => ({
        id: row.id,
        projectId: row.projectId,
        kind: row.kind,
      }));
    },

    async listReadyIssues(source) {
      const [row] = await db.select().from(sources).where(eq(sources.id, source.id)).limit(1);
      if (!row) return [];
      const token = await resolveGithubToken(row.secretId);
      if (!token) return [];
      const github = createGitHubSource({
        owner: row.config.owner,
        repo: row.config.repo,
        label: row.config.label,
        token,
      });
      return github.listReady();
    },

    async existingExternalIds(sourceId) {
      const rows = await db
        .select({ externalId: workItems.externalId })
        .from(workItems)
        .where(eq(workItems.sourceId, sourceId));
      return new Set(rows.map((row) => row.externalId));
    },

    async insertWorkItem(input) {
      const [item] = await db
        .insert(workItems)
        .values({
          projectId: input.projectId,
          sourceId: input.sourceId,
          externalId: input.externalId,
          title: input.title,
          body: input.body,
          url: input.url,
          status: "queued",
          workflowId: input.workflowId,
        })
        .returning();
      return {
        id: item.id,
        projectId: item.projectId,
        sourceId: item.sourceId,
        externalId: item.externalId,
        workflowId: item.workflowId,
        status: item.status,
      };
    },

    async listOrphanCandidates() {
      const rows = await db
        .select()
        .from(workItems)
        .where(
          inArray(workItems.status, [
            "queued",
            "running",
            "waiting_review",
            "needs_user",
            "merged",
          ]),
        );
      return rows.map((row) => ({
        id: row.id,
        projectId: row.projectId,
        sourceId: row.sourceId,
        externalId: row.externalId,
        workflowId: row.workflowId,
        status: row.status,
        phase: row.phase,
        currentAgent: row.currentAgent,
        integrateAttempts: row.integrateAttempts,
        revisionLoops: row.revisionLoops,
        error: row.error,
      }));
    },

    async workflowPresence(workflowId) {
      try {
        const handle = client.workflow.getHandle(workflowId);
        const desc = await handle.describe();
        return desc.status.name === "RUNNING" ? "running" : "terminal";
      } catch (err) {
        if (err instanceof WorkflowNotFoundError) return "absent";
        return "unknown";
      }
    },

    async startWorkItemWorkflow(input) {
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
      try {
        await client.workflow.start("workItemWorkflow", {
          taskQueue: TASK_QUEUE,
          workflowId: input.workflowId,
          args,
        });
      } catch (err) {
        if (!(err instanceof WorkflowExecutionAlreadyStartedError)) throw err;
        // Prior run finished / id taken — mint a new workflow id and retry once.
        const workflowId = `${input.workflowId.replace(/-r\d+$/, "")}-r${Date.now()}`;
        await db
          .update(workItems)
          .set({
            workflowId,
            ...(input.hold ? {} : { status: "queued" }),
          })
          .where(eq(workItems.id, input.workItemId));
        await client.workflow.start("workItemWorkflow", {
          taskQueue: TASK_QUEUE,
          workflowId,
          args,
        });
      }
    },
  };
}

export async function runDefaultIntakePass(): Promise<IntakePassResult> {
  const sql = getLockSql();
  const [row] = await sql`select pg_try_advisory_lock(${INTAKE_LOCK_KEY}) as ok`;
  if (!row?.ok) {
    return { started: 0, repaired: 0 };
  }
  try {
    return await runIntakePass(await createDefaultIntakeDeps());
  } finally {
    await sql`select pg_advisory_unlock(${INTAKE_LOCK_KEY})`;
  }
}
