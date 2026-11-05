import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import {
  projects,
  runs,
  secrets,
  sources,
  workItemArtifacts,
  workItems,
} from "../db/schema.js";
import { decryptSecret } from "../crypto/secrets.js";
import { createGitHubSource } from "../connectors/github.js";
import { getHarness } from "../harnesses/index.js";
import { cleanupWorkspace, commitAll, prepareWorkspace, pushHead } from "../git/workspace.js";
import { redactSecrets } from "../secrets/redact.js";
import {
  loadAgentFromConfig,
  loadFactoryConfigAtSha,
  parseGithubRepo,
  resolveConfigRepo,
  resolveGithubToken,
} from "../config/resolve.js";
import type { AgentActivityResult, AgentDecision } from "./shared.js";
import type { MergeGate } from "./ship.js";
import type { PipelineConfig } from "../config/load.js";
import { getLocalBaseUrl, LOCAL_BASE_URL_KEY } from "../services/project-settings.js";
import { learnFindingsInstructions } from "../suggestions/findings.js";
import { recentFailedRuns, saveLearnSuggestions } from "../suggestions/save.js";

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
  const keyName = harness === "claude-code" ? "ANTHROPIC_API_KEY" : harness === "local" ? "LOCAL_API_KEY" : "CURSOR_API_KEY";
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

export async function pinConfigSha(input: {
  workItemId: string;
  sourceId: string;
}): Promise<{ configSha: string; pipeline: PipelineConfig }> {
  const [item] = await db.select().from(workItems).where(eq(workItems.id, input.workItemId)).limit(1);
  if (!item) throw new Error("work item not found");
  if (item.configSha) {
    const { config } = await loadFactoryConfigAtSha({
      sha: item.configSha,
      sourceId: input.sourceId,
    });
    return { configSha: item.configSha, pipeline: config.pipeline };
  }
  const { config, sha } = await loadFactoryConfigAtSha({ sourceId: input.sourceId });
  await db.update(workItems).set({ configSha: sha }).where(eq(workItems.id, item.id));
  return { configSha: sha, pipeline: config.pipeline };
}

/** Current factory-config default branch. Does not move the work item pin. */
export async function latestConfigSha(input: {
  sourceId: string;
}): Promise<{ configSha: string; pipeline: PipelineConfig }> {
  const { config, sha } = await loadFactoryConfigAtSha({ sourceId: input.sourceId });
  return { configSha: sha, pipeline: config.pipeline };
}

export async function getPipelineForWorkItem(input: {
  workItemId: string;
  sourceId: string;
}): Promise<PipelineConfig> {
  const [item] = await db.select().from(workItems).where(eq(workItems.id, input.workItemId)).limit(1);
  if (!item?.configSha) throw new Error("work item has no config_sha");
  const { config } = await loadFactoryConfigAtSha({
    sha: item.configSha,
    sourceId: input.sourceId,
  });
  return config.pipeline;
}

export async function runAgentActivity(input: {
  workItemId: string;
  projectId: string;
  sourceId: string;
  agentName: string;
  priorTranscripts: string[];
  humanNote?: string;
  configSha?: string;
}): Promise<AgentActivityResult> {
  const [item] = await db.select().from(workItems).where(eq(workItems.id, input.workItemId)).limit(1);
  const [project] = await db.select().from(projects).where(eq(projects.id, input.projectId)).limit(1);

  if (!item || !project) {
    return {
      runId: "",
      transcript: "",
      status: "error",
      error: "Missing work item or project",
    };
  }

  const configSha = input.configSha ?? item.configSha;
  if (!configSha) {
    return {
      runId: "",
      transcript: "",
      status: "error",
      error: "Missing config_sha on work item",
    };
  }

  let agent;
  let pipeline;
  let repoUrl: string;
  try {
    const loaded = await loadAgentFromConfig({
      sha: configSha,
      sourceId: input.sourceId,
      agentName: input.agentName,
    });
    agent = loaded.agent;
    pipeline = loaded.config.pipeline;
    repoUrl = loaded.repoUrl;
  } catch (err) {
    return {
      runId: "",
      transcript: "",
      status: "error",
      error: redactSecrets(err instanceof Error ? err.message : String(err)),
    };
  }

  const isLearn = agent.name === pipeline.learnAgent;
  const needsWorkspace =
    pipeline.workspaceAgents.includes(agent.name) || isLearn;
  const pushAgents = pipeline.pushAgents;
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

    if (isLearn) {
      const configToken = (await resolveGithubToken(input.sourceId)) ?? token;
      cwd = await prepareWorkspace({
        runId,
        repoUrl,
        token: configToken,
        sha: configSha,
        branch: `factory/learn-${item.externalId}`,
        baseBranch: "main",
      });
    } else if (needsWorkspace) {
      const branch = item.branch ?? `factory/${item.externalId}`;
      cwd = await prepareWorkspace({
        runId,
        repoUrl: project.repoUrl,
        token,
        branch: ["implement", "review", "verify"].includes(agent.name) ? branch : undefined,
        baseBranch: project.defaultBranch,
      });
      if (!item.branch && agent.name === "implement") {
        await db.update(workItems).set({ branch }).where(eq(workItems.id, item.id));
      }
    }

    const failedRuns = isLearn ? await recentFailedRuns(project.id) : [];
    const existingArtifacts = await db
      .select()
      .from(workItemArtifacts)
      .where(eq(workItemArtifacts.workItemId, item.id));

    const productDiffNote =
      isLearn && item.prNumber
        ? await github
            .getPrTimestamps(item.prNumber)
            .then(() => `# Product PR\n${item.prUrl ?? ""}\nConfig SHA: ${configSha}`)
            .catch(() => `# Product PR\n${item.prUrl ?? ""}\nConfig SHA: ${configSha}`)
        : "";

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
      productDiffNote,
      existingArtifacts.length
        ? `# Work item artifacts\n${existingArtifacts
            .map((a) => `## artifact:${a.kind}\n${a.content}`)
            .join("\n\n")}`
        : "",
      input.humanNote ? `# Human feedback\n${input.humanNote}` : "",
      input.priorTranscripts.length
        ? `# Prior agent summaries\n${input.priorTranscripts.join("\n\n")}`
        : "",
      isLearn ? learnFindingsInstructions(failedRuns) : "",
    ]
      .filter(Boolean)
      .join("\n");

    const apiKey = await getAgentApiKey(project.id, agent.harness);
    const harness = getHarness(agent.harness);
    const harnessInput: { cwd: string; prompt: string; model: string; apiKey?: string; baseURL?: string } = {
      cwd,
      prompt,
      model: agent.model,
      apiKey,
    };
    if ((agent.harness as string) === "local") {
      const baseURL = await getLocalBaseUrl(project.id);
      if (baseURL) harnessInput.baseURL = baseURL;
    }
    const result = await harness.run(harnessInput);
    transcript = redactSecrets(result.transcript);
    const resultError = result.error ? redactSecrets(result.error) : undefined;

    const decision = agent.name === "foreman" ? parseDecision(transcript) : null;
    const reviewVerdict = agent.name === "review" ? parseReviewVerdict(transcript) : undefined;
    const verifyVerdict = agent.name === "verify" ? parseVerifyVerdict(transcript) : undefined;

    if (result.status === "finished") {
      await upsertArtifacts(item.id, run.id, parseArtifacts(transcript));
    }

    if (isLearn && result.status === "finished") {
      const learnBranch = `factory/learn-${item.externalId}`;
      const committed = await commitAll(
        cwd,
        `factory(learn): improvements from #${item.externalId}`.slice(0, 72),
      );
      let prUrl: string | null = null;
      if (committed) {
        const gh = parseGithubRepo(await resolveConfigRepo());
        const configToken = (await resolveGithubToken(input.sourceId)) ?? token;
        if (gh) {
          const configGithub = createGitHubSource({
            owner: gh.owner,
            repo: gh.repo,
            label: "factory",
            token: configToken,
          });
          await configGithub.pushBranch(cwd, learnBranch, { force: true });
          const pr = await configGithub.ensureBranchAndPr({
            branch: learnBranch,
            base: "main",
            title: `[factory learn] agent improvements from #${item.externalId}`,
            body: transcript.slice(0, 4000),
            draft: false,
          });
          prUrl = pr.prUrl;
        } else {
          // Local config repo: push back to the path origin when possible.
          try {
            await pushHead(cwd, learnBranch, { force: true });
          } catch {
            // no remote — commit stays in the workspace clone only
          }
        }
      }
      await saveLearnSuggestions({
        projectId: project.id,
        workItemId: item.id,
        runId: run.id,
        externalId: item.externalId,
        transcript,
        prUrl,
        recordLegacy: committed,
        harness: agent.harness,
        model: agent.model,
        apiKey,
      });
    } else if (needsWorkspace && pushAgents.includes(agent.name) && result.status === "finished") {
      const branch = item.branch ?? `factory/${item.externalId}`;
      const committed = await commitAll(cwd, `factory(${agent.name}): ${item.title}`.slice(0, 72));
      if (committed || agent.name === "implement") {
        await github.pushBranch(cwd, branch);
        if (!item.prNumber && agent.name === "implement") {
          const pr = await github.ensureBranchAndPr({
            branch,
            base: project.defaultBranch,
            title: `[factory] ${item.title}`,
            body: `Factory work for ${item.url}\n\nAgent: ${agent.name}\n\n${transcript.slice(0, 2000)}`,
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
    }

    await github
      .comment(
        item.externalId,
        result.status === "finished"
          ? `Factory \`${agent.name}\` finished.\n\n${transcript.slice(0, 1500)}`
          : `Factory \`${agent.name}\` failed: ${resultError ?? "unknown"}`,
      )
      .catch(() => undefined);

    await db
      .update(runs)
      .set({
        status: result.status === "finished" ? "finished" : "error",
        transcript,
        decision,
        error: resultError ?? null,
        inputTokens: result.usage?.inputTokens,
        outputTokens: result.usage?.outputTokens,
        costUsd: result.usage?.costUsd != null ? String(result.usage.costUsd) : null,
        finishedAt: new Date(),
      })
      .where(eq(runs.id, run.id));

    return {
      runId: run.id,
      transcript,
      decision,
      reviewVerdict,
      verifyVerdict,
      status: result.status,
      error: resultError,
    };
  } catch (err) {
    const message = redactSecrets(err instanceof Error ? err.message : String(err));
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

export async function closeSourceIssue(input: {
  workItemId: string;
  sourceId: string;
}): Promise<void> {
  const [item] = await db.select().from(workItems).where(eq(workItems.id, input.workItemId)).limit(1);
  if (!item) throw new Error("Missing work item");
  const { github } = await getGithubForSource(input.sourceId);
  const comment = item.prUrl ? `Shipped in ${item.prUrl}` : "Shipped.";
  await github.closeIssue(item.externalId, comment);
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
  workItemId: string;
  sourceId: string;
  agentName: string;
}): Promise<boolean> {
  const [item] = await db.select().from(workItems).where(eq(workItems.id, input.workItemId)).limit(1);
  const { agent } = await loadAgentFromConfig({
    sha: item?.configSha,
    sourceId: input.sourceId,
    agentName: input.agentName,
  });
  return agent.waitForReview;
}

export async function canSpawn(input: {
  workItemId: string;
  sourceId: string;
  parentAgent: string;
  childAgent: string;
}): Promise<boolean> {
  const [item] = await db.select().from(workItems).where(eq(workItems.id, input.workItemId)).limit(1);
  try {
    const { agent } = await loadAgentFromConfig({
      sha: item?.configSha,
      sourceId: input.sourceId,
      agentName: input.childAgent,
    });
    return agent.spawnableBy.includes(input.parentAgent) || agent.spawnableBy.length === 0;
  } catch {
    return false;
  }
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
