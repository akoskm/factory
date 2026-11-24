import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { updateAgentHarnessModel } from "../agents/frontmatter.js";
import {
  configCacheDir,
  configMirrorDir,
  ensureConfigCheckout,
  parseGithubRepo,
} from "../config/checkout.js";
import { resolveGithubToken } from "../config/resolve.js";
import { createGitHubSource } from "../connectors/github.js";
import { githubAuthEnv } from "../git/auth.js";
import { commitAll } from "../git/workspace.js";
import { db } from "../db/index.js";
import { sources } from "../db/schema.js";
import { resolveConfigRepo } from "./instance-settings.js";
import { isHarness } from "./list-harness-models.js";

const exec = promisify(execFile);

function git(args: string[], opts: { cwd: string; token?: string }) {
  return exec("git", args, { cwd: opts.cwd, env: githubAuthEnv(opts.token) });
}

function isSafeAgentName(name: string): boolean {
  return /^[a-z0-9_-]+$/i.test(name);
}

async function resolveGithubTokenForProject(projectId: string): Promise<string> {
  const rows = await db.select().from(sources).where(eq(sources.projectId, projectId));
  for (const row of rows) {
    const token = await resolveGithubToken(row.id);
    if (token) return token;
  }
  const fallback = await resolveGithubToken();
  if (!fallback) {
    throw new Error("GitHub token required — add a project source or GITHUB_TOKEN");
  }
  return fallback;
}

async function defaultBranch(mirrorDir: string): Promise<string> {
  try {
    const { stdout } = await git(["symbolic-ref", "refs/remotes/origin/HEAD"], { cwd: mirrorDir });
    const match = stdout.trim().match(/origin\/(.+)$/);
    if (match?.[1]) return match[1];
  } catch {
    // fall through
  }
  return "main";
}

export type AgentConfigChange = { name: string; harness: string; model: string };

export type AgentConfigPrResult = {
  prUrl: string;
  branch: string;
  changed: string[];
};

export async function openAgentConfigPr(input: {
  projectId: string;
  changes: AgentConfigChange[];
  allowedAgents: Set<string>;
}): Promise<AgentConfigPrResult> {
  if (!input.changes.length) {
    throw new Error("No agent changes to save");
  }

  const repoUrl = await resolveConfigRepo();
  const gh = parseGithubRepo(repoUrl);
  if (!gh) {
    throw new Error("factory-config must be a GitHub repository URL to open a pull request");
  }

  for (const change of input.changes) {
    if (!isSafeAgentName(change.name)) {
      throw new Error(`invalid agent name: ${change.name}`);
    }
    if (!input.allowedAgents.has(change.name)) {
      throw new Error(`unknown agent: ${change.name}`);
    }
    if (!isHarness(change.harness)) {
      throw new Error(`harness must be cursor, claude-code, or local (${change.name})`);
    }
    const model = change.model.trim();
    if (!model) {
      throw new Error(`model is required for ${change.name}`);
    }
  }

  const token = await resolveGithubTokenForProject(input.projectId);
  const cacheDir = configCacheDir();
  await ensureConfigCheckout({ repoUrl, token, cacheDir });

  const mirror = configMirrorDir(repoUrl, cacheDir);
  const base = await defaultBranch(mirror);
  await git(["fetch", "origin"], { cwd: mirror, token });
  await git(["checkout", "-f", base], { cwd: mirror });
  await git(["reset", "--hard", `origin/${base}`], { cwd: mirror });

  const branch = `factory/ui-agents-${randomBytes(4).toString("hex")}`;
  await git(["checkout", "-B", branch], { cwd: mirror });

  const changed: string[] = [];
  for (const change of input.changes) {
    const rel = path.join("agents", change.name, "agent.md");
    const filePath = path.join(mirror, rel);
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch {
      throw new Error(`missing ${rel} in factory-config`);
    }
    const next = updateAgentHarnessModel(raw, change.harness, change.model);
    if (next !== raw) {
      await writeFile(filePath, next, "utf8");
      changed.push(change.name);
    }
  }

  if (!changed.length) {
    throw new Error("No agent.md files changed — values already match factory-config");
  }

  const committed = await commitAll(
    mirror,
    `factory(ui): agent harness/model (${changed.join(", ")})`.slice(0, 72),
  );
  if (!committed) {
    throw new Error("Nothing to commit after updating agent.md");
  }

  const github = createGitHubSource({
    owner: gh.owner,
    repo: gh.repo,
    label: "factory",
    token,
  });
  await github.pushBranch(mirror, branch, { force: true });

  const lines = input.changes
    .filter((c) => changed.includes(c.name))
    .map((c) => `- **${c.name}**: \`${c.harness}\` · \`${c.model}\``);
  const pr = await github.ensureBranchAndPr({
    branch,
    base,
    title: "[factory] Update agent harness and model",
    body: `Configured from Factory Agents UI.\n\n${lines.join("\n")}`,
    draft: false,
  });

  return { prUrl: pr.prUrl, branch, changed };
}