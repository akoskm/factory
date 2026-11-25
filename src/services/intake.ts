import { WorkflowNotFoundError } from "@temporalio/client";
import { and, eq, inArray } from "drizzle-orm";
import postgres from "postgres";
import { createGitHubSource } from "../connectors/github.js";
import type { WorkItemInput } from "../connectors/types.js";
import { decryptSecret } from "../crypto/secrets.js";
import { db } from "../db/index.js";
import { secrets, sources, workItems } from "../db/schema.js";
import { getTemporalClient } from "../temporal/client.js";
import { intakeResume } from "../work-item-phase.js";
import {
  startWorkItemWorkflow,
  type StartWorkflowInput,
} from "./start-work-item-workflow.js";

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

export type { StartWorkflowInput };

/** Temporal workflow visibility for repair decisions. */
export type WorkflowPresence = "running" | "absent" | "terminal" | "unknown";

export type IntakeDeps = {
  listEnabledSources(): Promise<IntakeSource[]>;
  listReadyIssues(source: IntakeSource): Promise<WorkItemInput[]>;
  /** Map externalId → existing work item id + status (for refresh). */
  existingByExternalId(sourceId: string): Promise<Map<string, { id: string; status: string }>>;
  insertWorkItem(input: {
    projectId: string;
    sourceId: string;
    externalId: string;
    title: string;
    body: string;
    url: string;
    workflowId: string;
  }): Promise<IntakeWorkItem>;
  refreshListedWorkItem(
    id: string,
    fields: { title: string; body: string; url: string },
  ): Promise<void>;
  listOrphanCandidates(): Promise<IntakeWorkItem[]>;
  workflowPresence(workflowId: string): Promise<WorkflowPresence>;
  startWorkItemWorkflow(input: StartWorkflowInput): Promise<void>;
};

export type IntakePassResult = {
  /** New listed rows inserted this pass. */
  listed: number;
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

const NO_ORPHAN_REPAIR = new Set(["listed", "scheduled", "queued"]);

export async function runIntakePass(deps: IntakeDeps): Promise<IntakePassResult> {
  let listed = 0;
  let repaired = 0;

  const allSources = await deps.listEnabledSources();
  for (const source of allSources) {
    if (source.kind !== "github") continue;
    try {
      const ready = await deps.listReadyIssues(source);
      const existing = await deps.existingByExternalId(source.id);
      for (const issue of ready) {
        const prior = existing.get(issue.externalId);
        if (prior) {
          if (prior.status === "listed") {
            await deps.refreshListedWorkItem(prior.id, {
              title: issue.title,
              body: issue.body,
              url: issue.url,
            });
          }
          continue;
        }
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
        existing.set(issue.externalId, { id: item.id, status: item.status });
        listed += 1;
      }
    } catch (err) {
      console.error(`intake source ${source.id} failed`, err);
    }
  }

  const orphans = await deps.listOrphanCandidates();
  for (const item of orphans) {
    try {
      if (NO_ORPHAN_REPAIR.has(item.status)) continue;
      // Steer park: needs_user + foreman, wait for chat — do not auto-resume ship.
      if (item.status === "needs_user" && item.currentAgent === "foreman") continue;
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

  return { listed, repaired };
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

    async existingByExternalId(sourceId) {
      const rows = await db
        .select({
          id: workItems.id,
          externalId: workItems.externalId,
          status: workItems.status,
        })
        .from(workItems)
        .where(eq(workItems.sourceId, sourceId));
      return new Map(rows.map((row) => [row.externalId, { id: row.id, status: row.status }]));
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
          status: "listed",
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

    async refreshListedWorkItem(id, fields) {
      await db
        .update(workItems)
        .set({
          title: fields.title,
          body: fields.body,
          url: fields.url,
        })
        .where(and(eq(workItems.id, id), eq(workItems.status, "listed")));
    },

    async listOrphanCandidates() {
      const rows = await db
        .select()
        .from(workItems)
        .where(
          inArray(workItems.status, [
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

    startWorkItemWorkflow,
  };
}

export async function runDefaultIntakePass(): Promise<IntakePassResult> {
  const sql = getLockSql();
  const [row] = await sql`select pg_try_advisory_lock(${INTAKE_LOCK_KEY}) as ok`;
  if (!row?.ok) {
    return { listed: 0, repaired: 0 };
  }
  try {
    return await runIntakePass(await createDefaultIntakeDeps());
  } finally {
    await sql`select pg_advisory_unlock(${INTAKE_LOCK_KEY})`;
  }
}
