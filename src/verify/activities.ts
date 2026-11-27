import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { Octokit } from "@octokit/rest";
import { db } from "../db/index.js";
import {
  projects,
  proofSetupLocks,
  workItemArtifacts,
  workItems,
} from "../db/schema.js";
import { createGitHubSource } from "../connectors/github.js";
import { parseFrontmatter } from "../agents/loader.js";
import { loadAgentFromConfig, parseGithubRepo, resolveGithubToken } from "../config/resolve.js";
import { cleanupWorkspace, commitAll, prepareWorkspace } from "../git/workspace.js";
import { getProjectSetting, setProjectSetting } from "../services/project-settings.js";
import {
  listProofFiles,
  newUploadToken,
  publicFactoryUrl,
  readProofBytes,
  saveProofFile,
} from "./proof-store.js";
import type {
  DispatchProofResult,
  EnsureWorkflowResult,
  FinalizeProofResult,
  PlanVerifyResult,
  PollProofResult,
  ProofFileMeta,
  ProofSidecar,
  VerifyProofArtifact,
} from "./types.js";
import {
  detectStackHint,
  renderProofSidecar,
  renderProofWorkflow,
  renderRecordProofScript,
} from "./workflow-template.js";

export const PROOF_PAID_RUNNERS_KEY = "proof-paid-runners-ok";
export const DEFAULT_PROOF_WORKFLOW = "factory-proof.yml";
const SETUP_BRANCH = "factory/proof-setup";

type RepoCtx = {
  workItemId: string;
  projectId: string;
  sourceId: string;
  owner: string;
  repo: string;
  token: string;
  defaultBranch: string;
  repoUrl: string;
  branch: string | null;
  prNumber: number | null;
  prUrl: string | null;
  title: string;
  body: string;
  configSha: string | null;
};

async function loadRepoCtx(input: {
  workItemId: string;
  projectId: string;
  sourceId: string;
}): Promise<RepoCtx> {
  const [item] = await db.select().from(workItems).where(eq(workItems.id, input.workItemId)).limit(1);
  if (!item) throw new Error("work item not found");
  const [project] = await db.select().from(projects).where(eq(projects.id, input.projectId)).limit(1);
  if (!project) throw new Error("project not found");
  const token = await resolveGithubToken(input.sourceId);
  if (!token) throw new Error("GitHub token missing");
  const parsed = parseGithubRepo(project.repoUrl);
  if (!parsed) throw new Error(`unsupported repo URL: ${project.repoUrl}`);
  return {
    workItemId: item.id,
    projectId: project.id,
    sourceId: input.sourceId,
    owner: parsed.owner,
    repo: parsed.repo,
    token,
    defaultBranch: project.defaultBranch,
    repoUrl: project.repoUrl,
    branch: item.branch,
    prNumber: item.prNumber,
    prUrl: item.prUrl,
    title: item.title,
    body: item.body,
    configSha: item.configSha,
  };
}

function octokit(token: string): Octokit {
  return new Octokit({ auth: token });
}

export function parseVerifyProofConfig(frontmatter: Record<string, unknown>): {
  workflow: string;
} {
  const verify = (frontmatter.verify ?? {}) as Record<string, unknown>;
  const proof = (verify.proof ?? {}) as Record<string, unknown>;
  const workflow =
    typeof proof.workflow === "string" && proof.workflow.trim()
      ? proof.workflow.trim().replace(/^\.github\/workflows\//, "")
      : DEFAULT_PROOF_WORKFLOW;
  return { workflow };
}

async function readVerifyConfig(ctx: RepoCtx): Promise<{ workflow: string }> {
  try {
    const { agent } = await loadAgentFromConfig({
      sha: ctx.configSha,
      sourceId: ctx.sourceId,
      agentName: "verify",
    });
    const raw = await import("node:fs/promises").then((fs) => fs.readFile(agent.filePath, "utf8"));
    const { data } = parseFrontmatter(raw);
    return parseVerifyProofConfig(data);
  } catch {
    return { workflow: DEFAULT_PROOF_WORKFLOW };
  }
}

async function headFileExists(
  api: Octokit,
  owner: string,
  repo: string,
  filePath: string,
  ref: string,
): Promise<boolean> {
  try {
    await api.rest.repos.getContent({ owner, repo, path: filePath, ref });
    return true;
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 404) return false;
    throw err;
  }
}

async function listRepoPaths(api: Octokit, owner: string, repo: string, ref: string): Promise<string[]> {
  try {
    const { data } = await api.rest.git.getTree({ owner, repo, tree_sha: ref, recursive: "true" });
    return (data.tree ?? []).filter((t) => t.type === "blob" && t.path).map((t) => t.path!);
  } catch {
    return [];
  }
}

function parseSidecar(raw: string | null | undefined): ProofSidecar | null {
  if (!raw?.trim()) return null;
  try {
    return JSON.parse(raw) as ProofSidecar;
  } catch {
    return null;
  }
}

async function readSidecarFromDefault(
  api: Octokit,
  owner: string,
  repo: string,
  ref: string,
): Promise<ProofSidecar | null> {
  try {
    const { data } = await api.rest.repos.getContent({
      owner,
      repo,
      path: ".factory/proof.json",
      ref,
    });
    if (!("content" in data) || typeof data.content !== "string") return null;
    return parseSidecar(Buffer.from(data.content, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function runsOnLabel(sidecar: ProofSidecar | null): string {
  if (!sidecar?.runsOn) return "ubuntu-latest";
  return Array.isArray(sidecar.runsOn) ? sidecar.runsOn[0] ?? "ubuntu-latest" : sidecar.runsOn;
}

function isPaidRunner(runsOn: string): boolean {
  return /^(macos|windows)-/i.test(runsOn) || /macos-latest|windows-latest/i.test(runsOn);
}

function isGitHubHostedRunner(runsOn: string): boolean {
  return /^(ubuntu|macos|windows)-/i.test(runsOn.trim());
}

async function selfHostedRunnerOnline(
  api: Octokit,
  owner: string,
  repo: string,
  label: string,
): Promise<boolean> {
  try {
    const runners = await api.paginate(api.rest.actions.listSelfHostedRunnersForRepo, {
      owner,
      repo,
      per_page: 100,
    });
    const want = label.toLowerCase();
    return runners.some(
      (r) =>
        r.status === "online" &&
        (r.labels ?? []).some((l) => l.name?.toLowerCase() === want || l.name?.toLowerCase() === "self-hosted"),
    );
  } catch {
    return false;
  }
}

async function readVerifyProofArtifact(workItemId: string): Promise<VerifyProofArtifact | null> {
  const [row] = await db
    .select()
    .from(workItemArtifacts)
    .where(and(eq(workItemArtifacts.workItemId, workItemId), eq(workItemArtifacts.kind, "verify-proof")))
    .limit(1);
  if (!row?.content) return null;
  try {
    return JSON.parse(row.content) as VerifyProofArtifact;
  } catch {
    return null;
  }
}

function userVisiblePaths(paths: string[]): boolean {
  if (paths.length === 0) return true;
  const ignore =
    /(\.(md|txt|json|yml|yaml|lock)$|^\.github\/|^\.factory\/|\/migrations\/|\/drizzle\/|package-lock|pnpm-lock|yarn\.lock)/i;
  return paths.some((p) => !ignore.test(p));
}

/** Plan scenario, skip, or reuse prior proof for this SHA. */
export async function planVerifyScenario(input: {
  workItemId: string;
  projectId: string;
  sourceId: string;
  recheck?: boolean;
}): Promise<PlanVerifyResult> {
  const ctx = await loadRepoCtx(input);
  const { workflow } = await readVerifyConfig(ctx);
  const api = octokit(ctx.token);

  let sha: string | undefined;
  if (ctx.prNumber) {
    const { data: pr } = await api.rest.pulls.get({
      owner: ctx.owner,
      repo: ctx.repo,
      pull_number: ctx.prNumber,
    });
    sha = pr.head.sha;
  }
  if (!sha && ctx.branch) {
    const { data: ref } = await api.rest.git.getRef({
      owner: ctx.owner,
      repo: ctx.repo,
      ref: `heads/${ctx.branch}`,
    });
    sha = ref.object.sha;
  }
  if (!sha) {
    return {
      kind: "hold",
      holdKind: "bootstrap",
      note: "Verify needs a feature branch or pull request before it can record behavior.",
    };
  }

  const prior = await readVerifyProofArtifact(ctx.workItemId);
  if (prior?.sha === sha && prior.files?.length) {
    return {
      kind: "reuse",
      artifact: prior,
      verifyVerdict: prior.requiresHumanReview === false && prior.summary.includes("fail")
        ? "fail"
        : "accept",
    };
  }
  if (prior?.sha === sha) {
    return { kind: "reuse", artifact: prior, verifyVerdict: "accept" };
  }

  if (input.recheck && prior?.sha) {
    try {
      const { data } = await api.rest.repos.compareCommits({
        owner: ctx.owner,
        repo: ctx.repo,
        base: prior.sha,
        head: sha,
      });
      const files = (data.files ?? []).map((f) => f.filename);
      if (!userVisiblePaths(files)) {
        return { kind: "reuse", artifact: { ...prior, sha }, verifyVerdict: "accept" };
      }
    } catch {
      // compare failed — fall through to full run
    }
  }

  // Heuristic: only .factory / .github / docs → skip UI proof
  try {
    const base = ctx.defaultBranch;
    const { data } = await api.rest.repos.compareCommits({
      owner: ctx.owner,
      repo: ctx.repo,
      base,
      head: sha,
    });
    const files = (data.files ?? []).map((f) => f.filename);
    if (files.length > 0 && !userVisiblePaths(files)) {
      return {
        kind: "skip",
        reason: "Diff has no user-visible paths; skipping behavior proof.",
        verifyVerdict: "accept",
      };
    }
  } catch {
    // proceed to run
  }

  const scenario = [
    `Feature: ${ctx.title}`,
    ctx.body?.trim() ? `Issue:\n${ctx.body.trim().slice(0, 2000)}` : "",
    "Record the user-visible behavior this change introduces. Prefer the main happy path.",
  ]
    .filter(Boolean)
    .join("\n\n");

  return { kind: "run", sha, scenario, workflow };
}

/** Ensure proof workflow exists on default branch; bootstrap if missing. */
export async function ensureProofWorkflow(input: {
  workItemId: string;
  projectId: string;
  sourceId: string;
  workflow: string;
}): Promise<EnsureWorkflowResult> {
  const ctx = await loadRepoCtx(input);
  const api = octokit(ctx.token);
  const workflowPath = `.github/workflows/${input.workflow}`;

  if (await headFileExists(api, ctx.owner, ctx.repo, workflowPath, ctx.defaultBranch)) {
    const sidecar = await readSidecarFromDefault(api, ctx.owner, ctx.repo, ctx.defaultBranch);
    const runsOn = runsOnLabel(sidecar);
    if (isPaidRunner(runsOn)) {
      const ok = await getProjectSetting(ctx.projectId, PROOF_PAID_RUNNERS_KEY);
      if (ok !== "1") {
        return {
          kind: "hold",
          holdKind: "bootstrap",
          note: `Proof workflow uses paid runner \`${runsOn}\`. Continue to allow Factory to dispatch it on this project.`,
        };
      }
    }
    if (!isGitHubHostedRunner(runsOn)) {
      const online = await selfHostedRunnerOnline(api, ctx.owner, ctx.repo, runsOn);
      if (!online) {
        return {
          kind: "hold",
          holdKind: "bootstrap",
          note: `No online self-hosted runner with label \`${runsOn}\`. Bring a runner online, then Continue.`,
        };
      }
    }
    const required = sidecar?.requiredSecrets ?? [];
    if (required.length) {
      const missing = await missingSecretNames(api, ctx.owner, ctx.repo, required);
      if (missing.length) {
        return {
          kind: "hold",
          holdKind: "bootstrap",
          note: `Add these GitHub Actions secrets before proof can run: ${missing.join(", ")}`,
        };
      }
    }
    return { kind: "ready", workflow: input.workflow };
  }

  const [lock] = await db
    .select()
    .from(proofSetupLocks)
    .where(eq(proofSetupLocks.projectId, ctx.projectId))
    .limit(1);

  if (lock?.status === "open" && lock.setupPrNumber) {
    const { data: pr } = await api.rest.pulls.get({
      owner: ctx.owner,
      repo: ctx.repo,
      pull_number: lock.setupPrNumber,
    });
    if (pr.merged) {
      await db
        .update(proofSetupLocks)
        .set({ status: "merged", updatedAt: new Date() })
        .where(eq(proofSetupLocks.projectId, ctx.projectId));
      return { kind: "ready", workflow: input.workflow };
    }
    if (pr.state === "open") {
      return {
        kind: "hold",
        holdKind: "bootstrap",
        note: `Merge the Factory proof setup PR so verify can dispatch it: ${pr.html_url}`,
        setupPrUrl: pr.html_url,
      };
    }
  }

  // Create setup PR (single-flight)
  if (lock && lock.status === "open" && !lock.setupPrNumber) {
    return {
      kind: "waiting",
      note: "Another work item is creating the proof workflow. Waiting…",
    };
  }

  {
    const [existing] = await db
      .select()
      .from(proofSetupLocks)
      .where(eq(proofSetupLocks.projectId, ctx.projectId))
      .limit(1);
    if (existing) {
      await db
        .update(proofSetupLocks)
        .set({ status: "open", updatedAt: new Date() })
        .where(eq(proofSetupLocks.projectId, ctx.projectId));
    } else {
      await db.insert(proofSetupLocks).values({
        projectId: ctx.projectId,
        status: "open",
        updatedAt: new Date(),
      });
    }
  }

  const runId = `proof-setup-${ctx.projectId.slice(0, 8)}-${Date.now()}`;
  let cwd: string | undefined;
  try {
    cwd = await prepareWorkspace({
      runId,
      repoUrl: ctx.repoUrl,
      token: ctx.token,
      baseBranch: ctx.defaultBranch,
      branch: SETUP_BRANCH,
    });

    const paths = await listRepoPaths(api, ctx.owner, ctx.repo, ctx.defaultBranch);
    const hint = detectStackHint(paths.length ? paths : ["package.json"]);
    await mkdir(path.join(cwd, ".github", "workflows"), { recursive: true });
    await mkdir(path.join(cwd, ".factory"), { recursive: true });
    await writeFile(
      path.join(cwd, ".github", "workflows", input.workflow),
      renderProofWorkflow({
        workflowFileName: input.workflow,
        runsOn: hint.runsOn,
        startHint: hint.startHint,
      }),
      "utf8",
    );
    await writeFile(
      path.join(cwd, ".factory", "record-proof.sh"),
      renderRecordProofScript(hint.startHint),
      { encoding: "utf8", mode: 0o755 },
    );
    await writeFile(
      path.join(cwd, ".factory", "proof.json"),
      renderProofSidecar(hint),
      "utf8",
    );

    await commitAll(cwd, "Add Factory behavior proof workflow");
    const github = createGitHubSource({
      owner: ctx.owner,
      repo: ctx.repo,
      label: "factory",
      token: ctx.token,
    });
    await github.pushBranch(cwd, SETUP_BRANCH, { force: true });
    const pr = await github.ensureBranchAndPr({
      branch: SETUP_BRANCH,
      base: ctx.defaultBranch,
      title: "Add Factory behavior proof workflow",
      body: [
        "Factory generated this workflow so verify can record user-visible behavior on feature PRs.",
        "",
        "Inputs: `sha`, `scenario`, `pr_number`, `upload_url`, `upload_token`.",
        "",
        "Merge this PR (or approve if branch protection requires it) to continue the in-flight feature.",
      ].join("\n"),
      draft: false,
    });

    await db
      .update(proofSetupLocks)
      .set({
        setupPrNumber: pr.prNumber,
        setupPrUrl: pr.prUrl,
        status: "open",
        updatedAt: new Date(),
      })
      .where(eq(proofSetupLocks.projectId, ctx.projectId));

    try {
      await github.mergePr(pr.prNumber);
      await db
        .update(proofSetupLocks)
        .set({ status: "merged", updatedAt: new Date() })
        .where(eq(proofSetupLocks.projectId, ctx.projectId));
      if (isPaidRunner(hint.runsOn)) {
        const ok = await getProjectSetting(ctx.projectId, PROOF_PAID_RUNNERS_KEY);
        if (ok !== "1") {
          return {
            kind: "hold",
            holdKind: "bootstrap",
            note: `Proof workflow uses paid runner \`${hint.runsOn}\`. Continue to allow Factory to dispatch it on this project.`,
            setupPrUrl: pr.prUrl,
          };
        }
      }
      return { kind: "ready", workflow: input.workflow };
    } catch {
      return {
        kind: "hold",
        holdKind: "bootstrap",
        note: `Merge the Factory proof setup PR so verify can dispatch it: ${pr.prUrl}`,
        setupPrUrl: pr.prUrl,
      };
    }
  } finally {
    if (cwd) await cleanupWorkspace(path.basename(cwd)).catch(() => undefined);
  }
}

async function missingSecretNames(
  api: Octokit,
  owner: string,
  repo: string,
  required: string[],
): Promise<string[]> {
  try {
    const secrets = await api.paginate(api.rest.actions.listRepoSecrets, {
      owner,
      repo,
      per_page: 100,
    });
    const names = new Set(secrets.map((s) => s.name));
    return required.filter((n) => !names.has(n));
  } catch {
    return [];
  }
}

/** Confirm paid runners for this project (called after bootstrap Inbox approve). */
export async function confirmProofPaidRunners(input: {
  projectId: string;
}): Promise<void> {
  await setProjectSetting(input.projectId, PROOF_PAID_RUNNERS_KEY, "1");
}

export async function dispatchProofWorkflow(input: {
  workItemId: string;
  projectId: string;
  sourceId: string;
  workflow: string;
  sha: string;
  scenario: string;
}): Promise<DispatchProofResult> {
  const ctx = await loadRepoCtx(input);
  const api = octokit(ctx.token);
  const uploadToken = newUploadToken();
  const uploadUrl = `${publicFactoryUrl()}/api/internal/work-items/${ctx.workItemId}/proofs?sha=${encodeURIComponent(input.sha)}`;

  const [metaRow] = await db
    .select({ metadata: workItems.metadata })
    .from(workItems)
    .where(eq(workItems.id, ctx.workItemId))
    .limit(1);
  await db
    .update(workItems)
    .set({
      metadata: {
        ...(metaRow?.metadata ?? {}),
        proofUploadToken: uploadToken,
        proofUploadSha: input.sha,
      },
    })
    .where(eq(workItems.id, ctx.workItemId));

  const workflow_id = input.workflow;
  try {
    await api.rest.actions.createWorkflowDispatch({
      owner: ctx.owner,
      repo: ctx.repo,
      workflow_id,
      ref: ctx.defaultBranch,
      inputs: {
        sha: input.sha,
        scenario: input.scenario,
        pr_number: String(ctx.prNumber ?? ""),
        upload_url: uploadUrl,
        upload_token: uploadToken,
      },
    });
  } catch (err) {
    const status = (err as { status?: number }).status;
    const message = err instanceof Error ? err.message : String(err);
    if (status === 403 || status === 404) {
      return {
        kind: "hold",
        holdKind: "bootstrap",
        note:
          status === 403
            ? "GitHub token needs `actions:write` (and workflow permissions) to dispatch the proof workflow."
            : `Could not dispatch \`${workflow_id}\`: ${message}`,
      };
    }
    throw err;
  }

  // Resolve the new run (best-effort)
  await new Promise((r) => setTimeout(r, 2000));
  const runs = await api.rest.actions.listWorkflowRuns({
    owner: ctx.owner,
    repo: ctx.repo,
    workflow_id,
    event: "workflow_dispatch",
    per_page: 5,
  });
  const run = runs.data.workflow_runs[0];
  if (!run) {
    return {
      kind: "hold",
      holdKind: "bootstrap",
      note: "Dispatched the proof workflow but could not find the run yet. Continue to retry polling.",
    };
  }
  return { kind: "started", runId: run.id, runUrl: run.html_url };
}

export async function pollProofWorkflow(input: {
  workItemId: string;
  projectId: string;
  sourceId: string;
  workflow: string;
  runId: number;
}): Promise<PollProofResult> {
  const ctx = await loadRepoCtx(input);
  const api = octokit(ctx.token);
  const { data: run } = await api.rest.actions.getWorkflowRun({
    owner: ctx.owner,
    repo: ctx.repo,
    run_id: input.runId,
  });
  if (run.status !== "completed") return { kind: "running" };
  if (run.conclusion === "success") {
    return { kind: "success", runId: run.id, runUrl: run.html_url };
  }
  return {
    kind: "failure",
    runId: run.id,
    runUrl: run.html_url,
    note: `Proof workflow finished with conclusion \`${run.conclusion ?? "unknown"}\`. See ${run.html_url}`,
  };
}

/** Pull proof from Actions artifacts when the runner could not reach Factory. */
async function ingestActionsArtifacts(input: {
  ctx: RepoCtx;
  runId: number;
  sha: string;
}): Promise<void> {
  const api = octokit(input.ctx.token);
  const { data } = await api.rest.actions.listWorkflowRunArtifacts({
    owner: input.ctx.owner,
    repo: input.ctx.repo,
    run_id: input.runId,
    per_page: 20,
  });
  for (const art of data.artifacts ?? []) {
    if (art.expired) continue;
    if (!/proof/i.test(art.name)) continue;
    const zip = await api.rest.actions.downloadArtifact({
      owner: input.ctx.owner,
      repo: input.ctx.repo,
      artifact_id: art.id,
      archive_format: "zip",
    });
    const buf = Buffer.from(zip.data as ArrayBuffer);
    // Store the zip as a single proof file; reviewers can download it from Factory.
    await saveProofFile({
      workItemId: input.ctx.workItemId,
      filename: `${art.name}.zip`,
      mimeType: "application/zip",
      bytes: buf,
      title: art.name,
      sha: input.sha,
    });
  }
}

export async function finalizeVerifyProof(input: {
  workItemId: string;
  projectId: string;
  sourceId: string;
  sha: string;
  scenario: string;
  verifyVerdict: "accept" | "fail";
  runId?: number;
  runUrl?: string;
  summary?: string;
}): Promise<FinalizeProofResult> {
  const ctx = await loadRepoCtx(input);
  let files = await listProofFiles(ctx.workItemId, input.sha);
  if (files.length === 0 && input.runId) {
    try {
      await ingestActionsArtifacts({ ctx, runId: input.runId, sha: input.sha });
      files = await listProofFiles(ctx.workItemId, input.sha);
    } catch {
      // upload path is primary; artifact fallback is best-effort
    }
  }
  // Real proof = image/video large enough to be a screenshot (reject 1×1 stubs ~70B).
  const realMedia = files.filter(
    (f) =>
      f.size >= 2048 &&
      (/^(image|video)\//.test(f.mimeType) ||
        /\.(png|jpe?g|gif|webp|mp4|webm|mov)$/i.test(f.filename)),
  );
  const hasStubOnly =
    files.some((f) => /^(image)\//.test(f.mimeType) || /\.(png|jpe?g|gif|webp)$/i.test(f.filename)) &&
    realMedia.length === 0;

  let verifyVerdict = input.verifyVerdict;
  let summary =
    input.summary ??
    (verifyVerdict === "accept" ? "Behavior proof captured." : "Behavior proof failed.");
  if (verifyVerdict === "accept" && (files.length === 0 || hasStubOnly || realMedia.length === 0)) {
    verifyVerdict = "fail";
    summary =
      "Proof run produced no reviewable screenshot/video. The recorder must capture the real UI for this scenario.";
  }

  const requiresHumanReview = realMedia.length > 0 && verifyVerdict === "accept";

  const artifact: VerifyProofArtifact = {
    sha: input.sha,
    scenario: input.scenario,
    summary,
    requiresHumanReview,
    workflowRunId: input.runId,
    workflowRunUrl: input.runUrl,
    files: files.map(({ filename, mimeType, title, size }) => ({
      filename,
      mimeType,
      title,
      size,
    })),
    provedAt: new Date().toISOString(),
  };

  const content = JSON.stringify(artifact, null, 2);
  await db
    .insert(workItemArtifacts)
    .values({
      workItemId: ctx.workItemId,
      kind: "verify-proof",
      content,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [workItemArtifacts.workItemId, workItemArtifacts.kind],
      set: { content, updatedAt: new Date() },
    });

  if (ctx.prNumber && (artifact.files.length > 0 || input.runUrl)) {
    await commentProofOnPr(ctx, artifact);
  }

  const transcript = [
    `## verify proof`,
    `sha: ${input.sha}`,
    `verdict: ${verifyVerdict}`,
    requiresHumanReview ? "requiresHumanReview: true" : "requiresHumanReview: false",
    "",
    "```artifact:verify-proof",
    content,
    "```",
  ].join("\n");

  return {
    verifyVerdict,
    requiresHumanReview: artifact.requiresHumanReview,
    artifact,
    transcript,
  };
}

/** Publish proof bytes on a durable ref so PR markdown images do not depend on a tunnel URL. */
async function publishProofMedia(
  ctx: RepoCtx,
  file: ProofFileMeta,
  bytes: Buffer,
): Promise<string | null> {
  const api = octokit(ctx.token);
  const branch = "factory/proof-media";
  const remotePath = `proofs/${ctx.workItemId}/${file.filename}`;
  try {
    const { data: def } = await api.rest.repos.get({ owner: ctx.owner, repo: ctx.repo });
    const defaultBranch = def.default_branch || "main";
    try {
      await api.rest.git.getRef({ owner: ctx.owner, repo: ctx.repo, ref: `heads/${branch}` });
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status !== 404) throw err;
      const { data: baseRef } = await api.rest.git.getRef({
        owner: ctx.owner,
        repo: ctx.repo,
        ref: `heads/${defaultBranch}`,
      });
      await api.rest.git.createRef({
        owner: ctx.owner,
        repo: ctx.repo,
        ref: `refs/heads/${branch}`,
        sha: baseRef.object.sha,
      });
    }

    let sha: string | undefined;
    try {
      const { data: existing } = await api.rest.repos.getContent({
        owner: ctx.owner,
        repo: ctx.repo,
        path: remotePath,
        ref: branch,
      });
      if (!Array.isArray(existing) && "sha" in existing) sha = existing.sha;
    } catch {
      // new file
    }

    const { data: written } = await api.rest.repos.createOrUpdateFileContents({
      owner: ctx.owner,
      repo: ctx.repo,
      path: remotePath,
      message: `proof: ${file.filename}`,
      content: bytes.toString("base64"),
      branch,
      ...(sha ? { sha } : {}),
    });
    const commitSha = written.commit.sha;
    if (!commitSha) return null;
    return `https://raw.githubusercontent.com/${ctx.owner}/${ctx.repo}/${commitSha}/${remotePath}`;
  } catch {
    return null;
  }
}

async function commentProofOnPr(ctx: RepoCtx, artifact: VerifyProofArtifact): Promise<void> {
  if (!ctx.prNumber) return;
  const api = octokit(ctx.token);
  const lines = [
    "## Behavior proof",
    "",
    artifact.summary,
    "",
    `SHA: \`${artifact.sha}\``,
    artifact.workflowRunUrl ? `Workflow: ${artifact.workflowRunUrl}` : "",
    "",
  ];
  for (const file of artifact.files) {
    const local = await readProofBytes(ctx.workItemId, file.filename);
    const factoryUrl = `${publicFactoryUrl()}/api/work-items/${ctx.workItemId}/proofs/${encodeURIComponent(file.filename)}`;
    let url = factoryUrl;
    if (
      local &&
      (/^image\//.test(file.mimeType) || /\.(png|jpe?g|gif|webp)$/i.test(file.filename)) &&
      file.size >= 2048
    ) {
      const durable = await publishProofMedia(ctx, file, local.bytes);
      if (durable) url = durable;
    }
    if (/^image\//.test(file.mimeType) || /\.(png|jpe?g|gif|webp)$/i.test(file.filename)) {
      if (file.size < 2048) {
        lines.push(`- ${file.title ?? file.filename} (stub image omitted — not reviewable)`);
      } else {
        lines.push(`### ${file.title ?? file.filename}`, "", `![${file.title ?? file.filename}](${url})`, "");
      }
    } else {
      lines.push(`- [${file.title ?? file.filename}](${url})`);
    }
  }
  await api.rest.issues.createComment({
    owner: ctx.owner,
    repo: ctx.repo,
    issue_number: ctx.prNumber,
    body: lines.filter(Boolean).join("\n"),
  });
}

/** Validate upload token from work item metadata. */
export async function assertProofUploadToken(
  workItemId: string,
  token: string | undefined,
): Promise<{ sha: string | null }> {
  const [item] = await db.select().from(workItems).where(eq(workItems.id, workItemId)).limit(1);
  if (!item) throw new Error("not found");
  const meta = (item.metadata ?? {}) as Record<string, unknown>;
  const expected = typeof meta.proofUploadToken === "string" ? meta.proofUploadToken : "";
  if (!token || !expected || token !== expected) throw new Error("unauthorized");
  return { sha: typeof meta.proofUploadSha === "string" ? meta.proofUploadSha : null };
}

export async function ingestProofUpload(input: {
  workItemId: string;
  filename: string;
  mimeType: string;
  bytes: Buffer;
  sha?: string | null;
}): Promise<{ filename: string }> {
  const saved = await saveProofFile({
    workItemId: input.workItemId,
    filename: input.filename,
    mimeType: input.mimeType,
    bytes: input.bytes,
    sha: input.sha ?? undefined,
  });
  return { filename: saved.filename };
}
