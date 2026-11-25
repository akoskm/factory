import { and, asc, eq } from "drizzle-orm";
import { mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { db } from "../db/index.js";
import {
  projects,
  runs,
  secrets,
  sources,
  workItemArtifacts,
  workItemAttachments,
  workItemChatSessions,
  workItemMessages,
  workItems,
} from "../db/schema.js";
import { decryptSecret } from "../crypto/secrets.js";
import { createGitHubSource } from "../connectors/github.js";
import { loadAgentFromConfig } from "../config/resolve.js";
import { applyAgentOverride } from "../agents/override.js";
import {
  AGENT_DEFAULT_HARNESS_KEY,
  AGENT_DEFAULT_MODEL_KEY,
  getProjectSetting,
} from "./project-settings.js";
import { harnessKeyName } from "./list-harness-models.js";
import { cleanupWorkspace, prepareWorkspace } from "../git/workspace.js";
import { getTemporalClient, TASK_QUEUE } from "../temporal/client.js";
import type { AgentDecision } from "../temporal/shared.js";
import { parsePhase, type WorkPhase } from "../work-item-phase.js";
import { interruptIfRunning } from "./take-over.js";
import { syncInboxOnStatus } from "./inbox.js";
import { isImageMime, readAttachmentBytes } from "./attachments.js";

const MAX_STEER_IMAGES = 8;

/** Session-scoped advisory locks need a dedicated connection (not the pool). */
let steerLockSql: ReturnType<typeof postgres> | null = null;

function getSteerLockSql() {
  if (!steerLockSql) {
    const url =
      process.env.DATABASE_URL ?? "postgres://factory:factory@localhost:5432/factory";
    steerLockSql = postgres(url, { max: 1 });
  }
  return steerLockSql;
}

async function withSteerSendLock<T>(workItemId: string, fn: () => Promise<T>): Promise<T> {
  const sql = getSteerLockSql();
  const [row] = await sql`select pg_try_advisory_lock(hashtext(${workItemId})) as ok`;
  if (!row?.ok) throw new Error("steer send already in progress");
  try {
    return await fn();
  } finally {
    await sql`select pg_advisory_unlock(hashtext(${workItemId}))`;
  }
}

/**
 * Chat-only turns must not demote finished work to needs_user.
 * Do not treat phase===on_complete alone as done — mid post-merge takeover still needs finishMerged.
 */
async function parkAfterSteerChat(item: {
  id: string;
  status: string;
  currentAgent: string | null;
  completedAt: Date | null;
}): Promise<void> {
  if (item.status === "completed" || item.status === "merged") {
    return;
  }
  if (item.completedAt) {
    await db
      .update(workItems)
      .set({
        status: "completed",
        currentAgent: null,
        waitingForReview: false,
        error: null,
      })
      .where(eq(workItems.id, item.id));
    await syncInboxOnStatus(item.id, "completed");
    return;
  }
  await db
    .update(workItems)
    .set({ status: "needs_user", currentAgent: "foreman", waitingForReview: false })
    .where(eq(workItems.id, item.id));
  await syncInboxOnStatus(item.id, "needs_user");
}

export type SteerResume =
  | { kind: "fail"; error: string }
  | {
      kind: "start";
      phase: WorkPhase;
      startAgent: string;
      integrateAttempts: number;
      revisionLoops: number;
    };

/** Map a takeover foreman decision onto workflow resume args. */
export function resumeFromSteerDecision(input: {
  decision: AgentDecision;
  phase: string | null | undefined;
  integrateAttempts: number;
  revisionLoops: number;
  /** When false, complete skips the ship/merge gate (close-issue path). */
  hasPullRequest?: boolean;
}): SteerResume {
  if (input.decision.action === "fail") {
    return { kind: "fail", error: input.decision.note?.trim() || "foreman failed after takeover" };
  }

  const current = parsePhase(input.phase);

  if (input.decision.action === "complete") {
    // Already post-merge, or no PR → finishMerged / close-issue path (not ship/merge).
    if (current === "on_complete" || input.hasPullRequest === false) {
      return {
        kind: "start",
        phase: "on_complete",
        startAgent: "ship",
        integrateAttempts: input.integrateAttempts,
        revisionLoops: input.revisionLoops,
      };
    }
    return {
      kind: "start",
      phase: "ship",
      startAgent: "ship",
      integrateAttempts: input.integrateAttempts,
      revisionLoops: input.revisionLoops,
    };
  }

  const target = input.decision.agent?.trim();
  if (!target) {
    return { kind: "fail", error: "foreman spawn returned no agent" };
  }

  if (current === "integrate" || current === "recheck") {
    return {
      kind: "start",
      phase: current,
      startAgent: current === "integrate" ? "implement" : "verify",
      integrateAttempts: input.integrateAttempts,
      revisionLoops: input.revisionLoops,
    };
  }

  // Ship / on_complete are special workflow entry points — leave them so spawn runs the agent.
  if (current === "ship" || current === "on_complete") {
    return {
      kind: "start",
      phase: "step",
      startAgent: target,
      integrateAttempts: input.integrateAttempts,
      revisionLoops: input.revisionLoops,
    };
  }

  return {
    kind: "start",
    phase: "step",
    startAgent: target,
    integrateAttempts: input.integrateAttempts,
    revisionLoops: input.revisionLoops,
  };
}

export type ChatAttachmentView = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  url: string;
};

export type ChatMessageView = {
  id: string;
  role: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  runId: string | null;
  attachments: ChatAttachmentView[];
};

/** Prefer the last decision block so earlier example YAML does not drive the pipeline. */
export function parseDecision(transcript: string): AgentDecision | null {
  const indented = [...transcript.matchAll(/decision:\s*\n(?:[ \t].+\n?)+/gi)];
  const fences = [...transcript.matchAll(/```ya?ml\s*([\s\S]*?)```/gi)];
  let block: string | null = null;
  for (let i = indented.length - 1; i >= 0; i--) {
    if (/action:\s*(spawn|complete|fail)/i.test(indented[i][0])) {
      block = indented[i][0];
      break;
    }
  }
  if (!block) {
    for (let i = fences.length - 1; i >= 0; i--) {
      const body = fences[i][1] ?? fences[i][0];
      if (/action:\s*(spawn|complete|fail)/i.test(body)) {
        block = body;
        break;
      }
    }
  }
  if (!block) return null;
  const action = block.match(/action:\s*(spawn|complete|fail)/i)?.[1]?.toLowerCase() as
    | AgentDecision["action"]
    | undefined;
  const agent = block.match(/agent:\s*([a-z0-9_-]+)/i)?.[1]?.toLowerCase();
  const note = block.match(/note:\s*(.+)/i)?.[1]?.trim();
  if (!action) return null;
  return { action, agent, note };
}

function nextWorkflowId(current: string): string {
  const base = current.replace(/-r\d+$/, "");
  return `${base}-r${Date.now()}`;
}

async function getAgentApiKey(projectId: string, harness: string): Promise<string | undefined> {
  const keyName = harnessKeyName(harness);
  const rows = await db.select().from(secrets).where(eq(secrets.projectId, projectId));
  const found = rows.find((r) => r.key === keyName);
  if (found) return decryptSecret(found.ciphertext);
  return process.env[keyName];
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
    token,
    github: createGitHubSource({
      owner: source.config.owner,
      repo: source.config.repo,
      label: source.config.label,
      token,
    }),
  };
}

export async function listChatMessages(workItemId: string): Promise<ChatMessageView[]> {
  const messages = await db
    .select()
    .from(workItemMessages)
    .where(eq(workItemMessages.workItemId, workItemId))
    .orderBy(asc(workItemMessages.createdAt));
  if (messages.length === 0) return [];

  const attachments = await db
    .select()
    .from(workItemAttachments)
    .where(eq(workItemAttachments.workItemId, workItemId));

  const byMessage = new Map<string, ChatAttachmentView[]>();
  for (const a of attachments) {
    const list = byMessage.get(a.messageId) ?? [];
    list.push({
      id: a.id,
      filename: a.filename,
      mimeType: a.mimeType,
      size: a.size,
      url: `/api/work-items/${workItemId}/attachments/${a.id}`,
    });
    byMessage.set(a.messageId, list);
  }

  return messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
    runId: m.runId ?? null,
    attachments: byMessage.get(m.id) ?? [],
  }));
}

export async function getAttachmentForWorkItem(workItemId: string, attachmentId: string) {
  const [row] = await db
    .select()
    .from(workItemAttachments)
    .where(
      and(
        eq(workItemAttachments.id, attachmentId),
        eq(workItemAttachments.workItemId, workItemId),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function ensureOpenSession(workItemId: string) {
  const [session] = await db
    .select()
    .from(workItemChatSessions)
    .where(eq(workItemChatSessions.workItemId, workItemId))
    .limit(1);
  if (!session || session.status !== "open") {
    throw new Error("take over first");
  }
  return session;
}

function takenOver(meta: Record<string, unknown> | null | undefined): boolean {
  return meta?.takenOver === true;
}

async function materializeSteerFiles(
  cwd: string,
  attachments: { absPath: string; relPath: string; filename: string }[],
): Promise<string[]> {
  const paths: string[] = [];
  for (const a of attachments) {
    const dest = path.join(cwd, a.relPath);
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(a.absPath, dest);
    paths.push(a.relPath);
  }
  return paths;
}

function takeoverSystemAddon(): string {
  return [
    "# Takeover chat mode",
    "You are talking directly with the human who took over this factory work item.",
    "Keep the human-facing reply to 1–3 short sentences. No long status dumps, no repeating yourself.",
    "Ask follow-up questions when something is unclear or blocked.",
    "When you have enough direction to continue the factory pipeline, put a decision block ALONE at the very end (machine-read; humans will not see it):",
    "```yaml",
    "decision:",
    "  action: spawn   # or complete | fail",
    "  agent: implement  # when action is spawn",
    "  note: short plan",
    "```",
    "Do not narrate the YAML. If you still need the human, do NOT emit a decision — ask them instead.",
    "Screenshots and files the human attached are under `.factory/steer/` and may also be attached as images.",
  ].join("\n");
}

async function buildSteerSummary(workItemId: string): Promise<string> {
  const msgs = await listChatMessages(workItemId);
  const lines: string[] = ["# Human takeover steer"];
  for (const m of msgs.slice(-12)) {
    const who = m.role === "user" ? "Human" : "Foreman";
    const files =
      m.attachments.length > 0
        ? `\nAttachments: ${m.attachments.map((a) => a.filename).join(", ")}`
        : "";
    lines.push(`## ${who}\n${m.content}${files}`);
  }
  const allAtt = await db
    .select()
    .from(workItemAttachments)
    .where(eq(workItemAttachments.workItemId, workItemId));
  if (allAtt.length) {
    lines.push(
      `# Steer files on disk (relative to workspace)\n${allAtt
        .map((a) => `- .factory/steer/${path.basename(a.path)} (${a.filename})`)
        .join("\n")}`,
    );
  }
  return lines.join("\n\n");
}

/** Apply a foreman decision. Returns true when a workflow was started. */
async function continuePipeline(workItemId: string, decision: AgentDecision): Promise<boolean> {
  const [item] = await db.select().from(workItems).where(eq(workItems.id, workItemId)).limit(1);
  if (!item) throw new Error("not found");

  const humanNote = await buildSteerSummary(workItemId);
  await db
    .insert(workItemArtifacts)
    .values({
      workItemId: item.id,
      kind: "steer",
      content: humanNote,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [workItemArtifacts.workItemId, workItemArtifacts.kind],
      set: { content: humanNote, updatedAt: new Date() },
    });

  const resume = resumeFromSteerDecision({
    decision,
    phase: item.phase,
    integrateAttempts: item.integrateAttempts,
    revisionLoops: item.revisionLoops,
    hasPullRequest: item.prNumber != null,
  });

  const metadata = {
    ...(item.metadata ?? {}),
    takenOver: true,
    lastSteerDecision: decision,
    lastSteerNote: decision.note ?? null,
  };

  if (resume.kind === "fail") {
    await db
      .update(workItems)
      .set({
        status: "failed",
        error: resume.error,
        waitingForReview: false,
        currentAgent: "foreman",
        metadata,
      })
      .where(eq(workItems.id, item.id));
    await syncInboxOnStatus(item.id, "failed");
    return false;
  }

  const client = await getTemporalClient();
  const workflowId = nextWorkflowId(item.workflowId);
  const previous = {
    workflowId: item.workflowId,
    status: item.status,
    phase: item.phase,
    currentAgent: item.currentAgent,
    error: item.error,
    waitingForReview: item.waitingForReview,
    integrateAttempts: item.integrateAttempts,
    revisionLoops: item.revisionLoops,
  };

  await db
    .update(workItems)
    .set({
      workflowId,
      status: "queued",
      phase: resume.phase,
      error: null,
      waitingForReview: false,
      currentAgent: resume.startAgent === "ship" ? null : resume.startAgent,
      integrateAttempts: resume.integrateAttempts,
      revisionLoops: resume.revisionLoops,
      metadata,
    })
    .where(eq(workItems.id, item.id));
  await syncInboxOnStatus(item.id, "queued");

  try {
    await client.workflow.start("workItemWorkflow", {
      taskQueue: TASK_QUEUE,
      workflowId,
      args: [
        {
          workItemId: item.id,
          projectId: item.projectId,
          sourceId: item.sourceId,
          externalId: item.externalId,
          startAgent: resume.startAgent,
          phase: resume.phase,
          integrateAttempts: resume.integrateAttempts,
          revisionLoops: resume.revisionLoops,
        },
      ],
    });
  } catch (err) {
    await db
      .update(workItems)
      .set({
        workflowId: previous.workflowId,
        status: "needs_user",
        phase: previous.phase,
        currentAgent: previous.currentAgent ?? "foreman",
        error: previous.error,
        waitingForReview: previous.waitingForReview,
        integrateAttempts: previous.integrateAttempts,
        revisionLoops: previous.revisionLoops,
        metadata: {
          ...(item.metadata ?? {}),
          takenOver: true,
          lastSteerDecision: decision,
          lastSteerStartError: err instanceof Error ? err.message : String(err),
        },
      })
      .where(eq(workItems.id, item.id));
    await syncInboxOnStatus(item.id, "needs_user");
    throw err;
  }

  return true;
}

export type SendMessageInput = {
  workItemId: string;
  text: string;
  files: { filename: string; mimeType: string; bytes: Buffer; absPath: string; relPath: string; size: number }[];
  onDelta?: (text: string) => void | Promise<void>;
};

export type SendMessageResult = {
  userMessageId: string;
  assistantMessageId: string;
  content: string;
  continuedPipeline: boolean;
  decision: AgentDecision | null;
};

export async function sendTakeoverMessage(input: SendMessageInput): Promise<SendMessageResult> {
  return withSteerSendLock(input.workItemId, () => sendTakeoverMessageLocked(input));
}

async function sendTakeoverMessageLocked(input: SendMessageInput): Promise<SendMessageResult> {
  const [item] = await db
    .select()
    .from(workItems)
    .where(eq(workItems.id, input.workItemId))
    .limit(1);
  if (!item) throw new Error("not found");
  if (!takenOver(item.metadata)) throw new Error("take over first");

  await interruptIfRunning(item.id);
  const session = await ensureOpenSession(item.id);

  const [userMsg] = await db
    .insert(workItemMessages)
    .values({
      workItemId: item.id,
      sessionId: session.id,
      role: "user",
      content: input.text,
    })
    .returning();

  for (const f of input.files) {
    await db.insert(workItemAttachments).values({
      workItemId: item.id,
      messageId: userMsg.id,
      filename: f.filename,
      mimeType: f.mimeType,
      path: f.absPath,
      size: f.size,
    });
  }

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, item.projectId))
    .limit(1);
  if (!project) throw new Error("project not found");

  const loaded = await loadAgentFromConfig({
    sha: item.configSha,
    sourceId: item.sourceId,
    agentName: "foreman",
  });
  const override = {
    harness: await getProjectSetting(project.id, AGENT_DEFAULT_HARNESS_KEY),
    model: await getProjectSetting(project.id, AGENT_DEFAULT_MODEL_KEY),
  };
  const agent = applyAgentOverride(loaded.agent, override);
  const apiKey = await getAgentApiKey(project.id, agent.harness);
  if (!apiKey) throw new Error(`Missing API key for harness ${agent.harness}`);

  const { token } = await githubForSource(item.sourceId);
  const runId = randomUUID();
  const workspaceRunId = `takeover-${item.id}-${runId}`;
  const branch = item.branch ?? `factory/${item.externalId}`;

  const cwd = await prepareWorkspace({
    runId: workspaceRunId,
    repoUrl: project.repoUrl,
    token,
    // Always use the work-item branch (existing or factory/<issue>) so early takeovers
    // still see the factory branch when present on the remote.
    branch,
    baseBranch: project.defaultBranch,
  });

  const fileMeta = input.files.map((f) => ({
    absPath: f.absPath,
    relPath: f.relPath,
    filename: f.filename,
  }));
  // Also re-materialize prior steer attachments
  const prior = await db
    .select()
    .from(workItemAttachments)
    .where(eq(workItemAttachments.workItemId, item.id));
  for (const p of prior) {
    if (fileMeta.some((f) => f.absPath === p.path)) continue;
    fileMeta.push({
      absPath: p.path,
      relPath: path.join(".factory", "steer", path.basename(p.path)),
      filename: p.filename,
    });
  }
  const steerPaths = await materializeSteerFiles(cwd, fileMeta);

  const [assistantMsg] = await db
    .insert(workItemMessages)
    .values({
      workItemId: item.id,
      sessionId: session.id,
      role: "assistant",
      content: "",
    })
    .returning();

  const imageParts: { data: string; mimeType: string }[] = [];
  const imageSources = [
    ...input.files.map((f) => ({ absPath: f.absPath, mimeType: f.mimeType })),
    ...prior
      .filter((p) => !input.files.some((f) => f.absPath === p.path))
      .map((p) => ({ absPath: p.path, mimeType: p.mimeType })),
  ];
  for (const src of imageSources) {
    if (imageParts.length >= MAX_STEER_IMAGES) break;
    if (!isImageMime(src.mimeType)) continue;
    try {
      const bytes = await readAttachmentBytes(src.absPath);
      imageParts.push({ data: bytes.toString("base64"), mimeType: src.mimeType });
    } catch {
      // missing file on disk
    }
  }

  const priorTurns = await db
    .select({
      role: workItemMessages.role,
      content: workItemMessages.content,
    })
    .from(workItemMessages)
    .where(
      and(
        eq(workItemMessages.workItemId, item.id),
        eq(workItemMessages.sessionId, session.id),
      ),
    )
    .orderBy(asc(workItemMessages.createdAt));
  // Non-empty turns before this request's user message (last non-empty row).
  const priorChat = priorTurns.filter((m) => m.content.trim()).slice(0, -1);

  function buildPrompt(includeHistory: boolean): string[] {
    return [
      takeoverSystemAddon(),
      "",
      `# Agent: foreman`,
      agent.instructions,
      "",
      `# Work item`,
      `Title: ${item.title}`,
      `URL: ${item.url}`,
      "",
      item.body,
      "",
      steerPaths.length
        ? `# Attached steer files\n${steerPaths.map((p) => `- ${p}`).join("\n")}`
        : "",
      "",
      includeHistory && priorChat.length > 0
        ? [
            `# Prior steer chat`,
            ...priorChat.map(
              (m) => `## ${m.role === "user" ? "Human" : "Foreman"}\n${m.content.trim()}`,
            ),
            "",
          ].join("\n")
        : "",
      `# Human message`,
      input.text || "(see attached files)",
    ].filter(Boolean);
  }

  let transcript = "";
  let decision: AgentDecision | null = null;

  try {
    if (agent.harness === "cursor") {
      const { Agent } = await import("@cursor/sdk");
      const createOpts = {
        apiKey,
        model: { id: agent.model || "composer-2" },
        local: { cwd, settingSources: ["project"] as ("project")[] },
      };

      let agentHandle: Awaited<ReturnType<typeof Agent.create>>;
      let resumed = false;
      if (session.cursorAgentId) {
        try {
          agentHandle = await Agent.resume(session.cursorAgentId, createOpts);
          resumed = true;
        } catch {
          await db
            .update(workItemChatSessions)
            .set({ cursorAgentId: null, updatedAt: new Date() })
            .where(eq(workItemChatSessions.id, session.id));
          agentHandle = await Agent.create(createOpts);
        }
      } else {
        agentHandle = await Agent.create(createOpts);
      }

      if (!resumed && agentHandle.agentId) {
        await db
          .update(workItemChatSessions)
          .set({ cursorAgentId: agentHandle.agentId, updatedAt: new Date() })
          .where(eq(workItemChatSessions.id, session.id));
      }

      const promptParts = buildPrompt(!resumed);

      try {
        const message =
          imageParts.length > 0
            ? { text: promptParts.join("\n"), images: imageParts }
            : promptParts.join("\n");

        const flush = async (text: string) => {
          transcript = text;
          await db
            .update(workItemMessages)
            .set({ content: transcript, updatedAt: new Date() })
            .where(eq(workItemMessages.id, assistantMsg.id));
          await input.onDelta?.(transcript);
        };

        // Prefer stream events (full assistant messages). onDelta only if stream unsupported.
        const run = await agentHandle.send(message as never);
        if (run.supports("stream")) {
          const chunks: string[] = [];
          for await (const event of run.stream()) {
            if (event.type === "assistant") {
              for (const block of event.message.content) {
                if (block.type === "text") chunks.push(block.text);
              }
              await flush(chunks.join(""));
            }
          }
        }
        const result = await run.wait();
        if (!transcript.trim()) {
          transcript = String(result.result ?? "").trim();
        }
        if (transcript) await flush(transcript);
      } finally {
        await agentHandle[Symbol.asyncDispose]();
      }
    } else {
      // Non-cursor: one-shot harness run (no multi-turn SDK session)
      const { getHarness } = await import("../harnesses/index.js");
      const harness = getHarness(agent.harness);
      const result = await harness.run({
        cwd,
        prompt: buildPrompt(true).join("\n"),
        model: agent.model,
        apiKey,
      });
      transcript = result.transcript || result.error || "";
      await input.onDelta?.(transcript);
    }

    decision = parseDecision(transcript);
    await db
      .update(workItemMessages)
      .set({ content: transcript, updatedAt: new Date() })
      .where(eq(workItemMessages.id, assistantMsg.id));

    await db.insert(runs).values({
      id: runId,
      workItemId: item.id,
      projectId: project.id,
      agentName: "foreman",
      harness: agent.harness,
      model: agent.model,
      status: "finished",
      transcript,
      decision,
      finishedAt: new Date(),
    });

    await db
      .update(workItemMessages)
      .set({ runId })
      .where(eq(workItemMessages.id, assistantMsg.id));

    let continuedPipeline = false;
    if (decision) {
      continuedPipeline = await continuePipeline(item.id, decision);
    } else {
      await parkAfterSteerChat(item);
    }

    return {
      userMessageId: userMsg.id,
      assistantMessageId: assistantMsg.id,
      content: transcript,
      continuedPipeline,
      decision,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!transcript.trim()) {
      await db.delete(workItemMessages).where(eq(workItemMessages.id, assistantMsg.id));
    } else {
      await db
        .update(workItemMessages)
        .set({
          content: `${transcript.trim()}\n\n(Error: ${message})`,
          updatedAt: new Date(),
        })
        .where(eq(workItemMessages.id, assistantMsg.id));
    }
    await parkAfterSteerChat(item);
    throw err;
  } finally {
    await cleanupWorkspace(workspaceRunId).catch(() => undefined);
  }
}

export async function workItemTakenOver(workItemId: string): Promise<boolean> {
  const [item] = await db.select().from(workItems).where(eq(workItems.id, workItemId)).limit(1);
  return Boolean(item && takenOver(item.metadata));
}
