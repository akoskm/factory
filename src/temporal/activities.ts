import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import {
  agents,
  projects,
  runs,
  secrets,
  sources,
  suggestions,
  workItemArtifacts,
  workItems,
} from "../db/schema.js";
import { decryptSecret } from "../crypto/secrets.js";
import { createGitHubSource } from "../connectors/github.js";
import { getHarness } from "../harnesses/index.js";
import { cleanupWorkspace, commitAll, prepareWorkspace } from "../git/workspace.js";
import { resolveWaitForReview } from "../services/agent-defaults.js";
import type { AgentActivityResult, AgentDecision } from "./shared.js";
import type { MergeGate } from "./ship.js";

function parseDecision(transcript: string): AgentDecision | null {
  const match = transcript.match(/decision:\s*\n(?:\s{2}.+\n)+/i) ?? transcript.match(/```ya?ml\s*([\s\S]*?)```/i);
  const block = match?.[0] ?? match?.[1];
  if (!block) return null;
  const action = block.match(/action:\s*(spawn|complete|fail)/i)?.[1]?.toLowerCase() as AgentDecision["action"] | undefined;
  const agent = block.match(/agent:\s*([a-z0-9_-]+)/i)?.[1]?.toLowerCase();
  const note = block.match(/note:\s*(.+)/i)?.[1]?.trim();
  if (!action) return null;
  return { action, agent, note };
}

function parseReviewVerdict(transcript: string): "accept" | "revise" | undefined {
  const v = transcript.match(/verdict:\s*(accept|revise)/i)?.[1]?.toLowerCase();
  return v === "accept" || v === "revise" ? v : undefined;
}

function parseVerifyVerdict(transcript: string): "accept" | "fail" | undefined {
  const v = transcript.match(/verdict:\s*(accept|fail)/i)?.[1]?.toLowerCase();
  return v === "accept" || v === "fail" ? v : undefined;
}

/** Parse ```artifact:<kind> ... ``` fences from agent output. */
export function parseArtifacts(transcript: string): { kind: string; content: string }[] {
  const out: { kind: string; content: string }[] = [];
  const re = /```artifact:([a-z0-9_-]+)\s*\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(transcript)) !== null) {
    const kind = match[1].toLowerCase();
    const content = match[2].trim();
    if (kind && content) out.push({ kind, content });
  }
  return out;
}

async function upsertArtifacts(
  workItemId: string,
  runId: string,
  artifacts: { kind: string; content: string }[],
): Promise<void> {
  for (const art of artifacts) {
    await db
      .insert(workItemArtifacts)
      .values({
        workItemId,
        kind: art.kind,
        content: art.content,
        runId,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [workItemArtifacts.workItemId, workItemArtifacts.kind],
        set: {
          content: art.content,
          runId,
          updatedAt: new Date(),
        },
      });
  }
}

async function getGithubForSource(sourceId: string) {
  const [source] = await db.select().from(sources).where(eq(sources.id, sourceId)).limit(1);
  if (!source) throw new Error(`source ${sourceId} not found`);
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
    token,
  };
}

async function getAgentApiKey(projectId: string, harness: string): Promise<string | undefined> {
  const keyName = harness === "claude-code" ? "ANTHROPIC_API_KEY" : "CURSOR_API_KEY";
  const rows = await db.select().from(secrets).where(eq(secrets.projectId, projectId));
  const found = rows.find((r) => r.key === keyName);
  if (found) return decryptSecret(found.ciphertext);
  return process.env[keyName];
}

export async function updateWorkItemStatus(input: {
  workItemId: string;
  status: string;
  currentAgent?: string | null;
  waitingForReview?: boolean;
  error?: string | null;
  branch?: string;
  prNumber?: number;
  prUrl?: string;
  prOpenedAt?: string;
  mergedAt?: string;
  completedAt?: string;
}): Promise<void> {
  const patch: Record<string, unknown> = { status: input.status };
  if (input.currentAgent !== undefined) patch.currentAgent = input.currentAgent;
  if (input.waitingForReview !== undefined) patch.waitingForReview = input.waitingForReview;
  if (input.error !== undefined) patch.error = input.error;
  if (input.branch !== undefined) patch.branch = input.branch;
  if (input.prNumber !== undefined) patch.prNumber = input.prNumber;
  if (input.prUrl !== undefined) patch.prUrl = input.prUrl;
  if (input.prOpenedAt) patch.prOpenedAt = new Date(input.prOpenedAt);
  if (input.mergedAt) patch.mergedAt = new Date(input.mergedAt);
  if (input.completedAt) patch.completedAt = new Date(input.completedAt);
  await db.update(workItems).set(patch).where(eq(workItems.id, input.workItemId));
}

export async function runAgentActivity(input: {
  workItemId: string;
  projectId: string;
  sourceId: string;
  agentName: string;
  priorTranscripts: string[];
  humanNote?: string;
}): Promise<AgentActivityResult> {
  const [item] = await db.select().from(workItems).where(eq(workItems.id, input.workItemId)).limit(1);
  const [project] = await db.select().from(projects).where(eq(projects.id, input.projectId)).limit(1);
  const [agent] = await db
    .select()
    .from(agents)
    .where(eq(agents.projectId, input.projectId))
    .then((rows) => [rows.find((a) => a.name === input.agentName)!]);

  if (!item || !project || !agent) {
    return {
      runId: "",
      transcript: "",
      status: "error",
      error: `Missing work item, project, or agent ${input.agentName}`,
    };
  }

  const needsWorkspace = ["spec", "implement", "review", "verify", "monitor", "triage"].includes(
    agent.name,
  );
  const pushAgents = ["implement", "verify", "monitor"];
  const runId = randomUUID();
  const [run] = await db
    .insert(runs)
    .values({
      id: runId,
      workItemId: item.id,
      projectId: project.id,
      agentName: agent.name,
      harness: agent.harness,
      model: agent.model,
      status: "running",
    })
    .returning();

  await db
    .update(workItems)
    .set({ status: "running", currentAgent: agent.name, waitingForReview: false, error: null })
    .where(eq(workItems.id, item.id));

  let cwd = process.cwd();
  let transcript = "";
  try {
    const { github, token } = await getGithubForSource(input.sourceId);
    if (needsWorkspace) {
      const branch = item.branch ?? `factory/${item.externalId}`;
      cwd = await prepareWorkspace({
        runId,
        repoUrl: project.repoUrl,
        token,
        branch: ["implement", "review", "verify", "monitor"].includes(agent.name) ? branch : undefined,
        baseBranch: project.defaultBranch,
      });
      if (!item.branch && agent.name === "implement") {
        await db.update(workItems).set({ branch }).where(eq(workItems.id, item.id));
      }
    }

    const existingArtifacts = await db
      .select()
      .from(workItemArtifacts)
      .where(eq(workItemArtifacts.workItemId, item.id));

    const prompt = [
      `# Agent: ${agent.name}`,
      agent.instructions,
      "",
      `# Work item`,
      `Title: ${item.title}`,
      `URL: ${item.url}`,
      "",
      item.body,
      "",
      existingArtifacts.length
        ? `# Work item artifacts\n${existingArtifacts
            .map((a) => `## artifact:${a.kind}\n${a.content}`)
            .join("\n\n")}`
        : "",
      input.humanNote ? `# Human feedback\n${input.humanNote}` : "",
      input.priorTranscripts.length
        ? `# Prior agent summaries\n${input.priorTranscripts.join("\n\n")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const apiKey = await getAgentApiKey(project.id, agent.harness);
    const harness = getHarness(agent.harness);
    const result = await harness.run({
      cwd,
      prompt,
      model: agent.model,
      apiKey,
    });
    transcript = result.transcript;

    const decision = agent.name === "foreman" ? parseDecision(result.transcript) : null;
    const reviewVerdict = agent.name === "review" ? parseReviewVerdict(result.transcript) : undefined;
    const verifyVerdict = agent.name === "verify" ? parseVerifyVerdict(result.transcript) : undefined;

    if (result.status === "finished") {
      await upsertArtifacts(item.id, run.id, parseArtifacts(result.transcript));
    }

    if (needsWorkspace && pushAgents.includes(agent.name) && result.status === "finished") {
      const branch = item.branch ?? `factory/${item.externalId}`;
      const committed = await commitAll(cwd, `factory(${agent.name}): ${item.title}`.slice(0, 72));
      if (committed || agent.name === "implement") {
        await github.pushBranch(cwd, branch);
        if (!item.prNumber && agent.name === "implement") {
          const pr = await github.ensureBranchAndPr({
            branch,
            base: project.defaultBranch,
            title: `[factory] ${item.title}`,
            body: `Factory work for ${item.url}\n\nAgent: ${agent.name}\n\n${result.transcript.slice(0, 2000)}`,
            draft: true,
          });
          await db
            .update(workItems)
            .set({
              branch,
              prNumber: pr.prNumber,
              prUrl: pr.prUrl,
              prOpenedAt: new Date(),
            })
            .where(eq(workItems.id, item.id));
        }
      }
      if (agent.name === "monitor" && committed) {
        const learnBranch = `factory/learn-${item.externalId}`;
        await github.pushBranch(cwd, learnBranch);
        const pr = await github.ensureBranchAndPr({
          branch: learnBranch,
          base: project.defaultBranch,
          title: `[factory learn] agent improvements from #${item.externalId}`,
          body: result.transcript.slice(0, 4000),
          draft: false,
        });
        await db.insert(suggestions).values({
          projectId: project.id,
          workItemId: item.id,
          runId: run.id,
          title: `Learn from #${item.externalId}`,
          body: result.transcript,
          prUrl: pr.prUrl,
        });
      }
    }

    await github.comment(
      item.externalId,
      result.status === "finished"
        ? `Factory \`${agent.name}\` finished.\n\n${result.transcript.slice(0, 1500)}`
        : `Factory \`${agent.name}\` failed: ${result.error ?? "unknown"}`,
    ).catch(() => undefined);

    await db
      .update(runs)
      .set({
        status: result.status === "finished" ? "finished" : "error",
        transcript: result.transcript,
        decision,
        error: result.error,
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
        costUsd: result.usage?.costUsd != null ? String(result.usage.costUsd) : null,
        finishedAt: new Date(),
      })
      .where(eq(runs.id, run.id));

    return {
      runId: run.id,
      transcript: result.transcript,
      decision,
      reviewVerdict,
      verifyVerdict,
      status: result.status,
      error: result.error,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(runs)
      .set({ status: "error", error: message, finishedAt: new Date(), transcript })
      .where(eq(runs.id, run.id));
    return { runId: run.id, transcript: "", status: "error", error: message };
  } finally {
    await cleanupWorkspace(runId).catch(() => undefined);
  }
}

export async function getPullRequestMergeGate(input: {
  workItemId: string;
  sourceId: string;
}): Promise<MergeGate> {
  const [item] = await db.select().from(workItems).where(eq(workItems.id, input.workItemId)).limit(1);
  if (!item?.prNumber) throw new Error("No PR to merge");
  const { github } = await getGithubForSource(input.sourceId);
  return github.getMergeGate(item.prNumber);
}

export async function mergePullRequest(input: {
  workItemId: string;
  sourceId: string;
}): Promise<{ mergedAt: string }> {
  const [item] = await db.select().from(workItems).where(eq(workItems.id, input.workItemId)).limit(1);
  if (!item?.prNumber) throw new Error("No PR to merge");
  const { github } = await getGithubForSource(input.sourceId);
  try {
    await github.markPrReady(item.prNumber);
  } catch {
    // already ready
  }
  await github.mergePr(item.prNumber);
  const mergedAt = new Date();
  await db
    .update(workItems)
    .set({ status: "merged", mergedAt, waitingForReview: false })
    .where(eq(workItems.id, item.id));
  return { mergedAt: mergedAt.toISOString() };
}

export async function syncPrTimestamps(input: {
  workItemId: string;
  sourceId: string;
}): Promise<void> {
  const [item] = await db.select().from(workItems).where(eq(workItems.id, input.workItemId)).limit(1);
  if (!item?.prNumber) return;
  const { github } = await getGithubForSource(input.sourceId);
  const ts = await github.getPrTimestamps(item.prNumber);
  await db
    .update(workItems)
    .set({
      prOpenedAt: ts.openedAt ?? item.prOpenedAt,
      firstReviewAt: ts.firstReviewAt ?? item.firstReviewAt,
      mergedAt: ts.mergedAt ?? item.mergedAt,
    })
    .where(eq(workItems.id, item.id));
}

export async function getAgentWaitSetting(input: {
  projectId: string;
  agentName: string;
}): Promise<boolean> {
  return resolveWaitForReview(input.projectId, input.agentName);
}

export async function canSpawn(input: {
  projectId: string;
  parentAgent: string;
  childAgent: string;
}): Promise<boolean> {
  const rows = await db.select().from(agents).where(eq(agents.projectId, input.projectId));
  const child = rows.find((a) => a.name === input.childAgent);
  if (!child) return false;
  return child.spawnableBy.includes(input.parentAgent) || child.spawnableBy.length === 0;
}

export async function pollIntake(): Promise<{ started: number }> {
  const allSources = await db.select().from(sources).where(eq(sources.enabled, true));
  let started = 0;
  const { getTemporalClient } = await import("./client.js");
  const client = await getTemporalClient();

  for (const source of allSources) {
    let token = process.env.GITHUB_TOKEN ?? "";
    if (source.secretId) {
      const [sec] = await db.select().from(secrets).where(eq(secrets.id, source.secretId)).limit(1);
      if (sec) token = decryptSecret(sec.ciphertext);
    }
    if (!token || source.kind !== "github") continue;

    try {
      const github = createGitHubSource({
        owner: source.config.owner,
        repo: source.config.repo,
        label: source.config.label,
        token,
      });
      const ready = await github.listReady();
      for (const issue of ready) {
        const existing = await db
          .select()
          .from(workItems)
          .where(eq(workItems.sourceId, source.id));
        if (existing.some((w) => w.externalId === issue.externalId)) continue;

        const workflowId = `wi-${source.projectId}-${source.id}-${issue.externalId}`;
        const [item] = await db
          .insert(workItems)
          .values({
            projectId: source.projectId,
            sourceId: source.id,
            externalId: issue.externalId,
            title: issue.title,
            body: issue.body,
            url: issue.url,
            status: "queued",
            workflowId,
          })
          .returning();

        await client.workflow.start("workItemWorkflow", {
          taskQueue: "factory",
          workflowId,
          args: [
            {
              workItemId: item.id,
              projectId: source.projectId,
              sourceId: source.id,
              externalId: issue.externalId,
            },
          ],
        });
        started += 1;
      }
    } catch (err) {
      console.error(`intake source ${source.id} failed`, err);
    }
  }
  return { started };
}
