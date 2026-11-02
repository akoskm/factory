import { access, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { githubAuthEnv, publicGitUrl } from "../git/auth.js";

const exec = promisify(execFile);

function git(args: string[], opts?: { cwd?: string; token?: string }) {
  return exec("git", args, { cwd: opts?.cwd, env: githubAuthEnv(opts?.token) });
}

export const FACTORY_CONFIG_REPO_KEY = "FACTORY_CONFIG_REPO";

/** Sync env-only lookup. Prefer resolveConfigRepo() which also reads Settings. */
export function configRepoFromEnv(): string | undefined {
  return process.env.FACTORY_CONFIG_REPO?.trim() || undefined;
}

export function requireConfigRepoFromEnv(): string {
  const repo = configRepoFromEnv();
  if (!repo) {
    throw new Error(
      "FACTORY_CONFIG_REPO is required (set it in Settings or as an env var / git URL to factory-config)",
    );
  }
  return repo;
}

/** @deprecated use resolveConfigRepo — kept for sync call sites during boot */
export function requireConfigRepo(): string {
  return requireConfigRepoFromEnv();
}

export function configCacheDir(): string {
  return path.resolve(process.env.FACTORY_CONFIG_DIR ?? path.resolve(process.cwd(), "config-cache"));
}

function isLocalPath(repo: string): boolean {
  return (
    repo.startsWith("/") ||
    repo.startsWith("./") ||
    repo.startsWith("../") ||
    repo.startsWith("file://")
  );
}

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Parse owner/repo from a github HTTPS or SSH URL. Local paths return null. */
export function parseGithubRepo(repo: string): { owner: string; repo: string } | null {
  if (isLocalPath(repo)) return null;
  const https = repo.match(/github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?$/i);
  if (!https) return null;
  return { owner: https[1], repo: https[2] };
}

/** GitHub blob URL, or a Cursor file link when the config repo is a local path. */
export function agentConfigFileUrl(repoUrl: string, sha: string, agentName: string): string | null {
  if (!/^[a-z0-9_-]+$/i.test(agentName)) return null;
  const gh = parseGithubRepo(repoUrl);
  if (gh) {
    if (!sha) return null;
    return `https://github.com/${gh.owner}/${gh.repo}/blob/${sha}/agents/${agentName}/agent.md`;
  }
  if (!isLocalPath(repoUrl)) return null;
  const root = path.resolve(repoUrl.replace(/^file:\/\//, ""));
  return `cursor://file${path.join(root, "agents", agentName, "agent.md")}`;
}

function safeGitPath(value: string): boolean {
  if (!value || value.startsWith("/") || value.endsWith("/")) return false;
  if (value.includes("..") || value.includes("//")) return false;
  return /^[A-Za-z0-9._/-]+$/.test(value);
}

/** GitHub editor for one file. `ref` is a branch name or commit SHA. */
export function githubFileEditUrl(repoUrl: string, ref: string, filePath: string): string | null {
  const gh = parseGithubRepo(repoUrl);
  if (!gh || !safeGitPath(ref) || !safeGitPath(filePath)) return null;
  return `https://github.com/${gh.owner}/${gh.repo}/edit/${ref}/${filePath}`;
}

function normalizeBranch(raw: string): string | null {
  const name = raw.trim().replace(/^\* /, "");
  if (!name || name.includes("HEAD") || name.includes("->")) return null;
  return name.replace(/^remotes\/origin\//, "").replace(/^origin\//, "");
}

async function branchPointingAt(dir: string, sha: string): Promise<string | null> {
  try {
    const { stdout } = await git(["branch", "-a", "--points-at", sha], { cwd: dir });
    const lines = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const remote = lines
      .filter((line) => line.includes("remotes/origin/") || /^\*?\s*origin\//.test(line))
      .map(normalizeBranch)
      .find((name): name is string => Boolean(name));
    if (remote) return remote;
    return lines.map(normalizeBranch).find((name): name is string => Boolean(name)) ?? null;
  } catch {
    return null;
  }
}

/**
 * Repo URL plus the ref GitHub's editor should open.
 * A local checkout uses its `origin` when that remote is GitHub, and the branch whose tip is `sha`.
 */
export function configMirrorDir(repoUrl: string, cacheDir = configCacheDir()): string {
  return mirrorDirFor(cacheDir, repoUrl);
}

/** GitHub repo plus the branch to open, or the commit when no branch tip matches. */
export async function configEditTarget(
  repoUrl: string,
  sha: string,
  cacheDir = configCacheDir(),
): Promise<{ repoUrl: string; ref: string } | null> {
  if (!safeGitPath(sha)) return null;
  let remote = repoUrl;
  const dirs: string[] = [configMirrorDir(repoUrl, cacheDir)];
  if (!parseGithubRepo(repoUrl)) {
    if (!isLocalPath(repoUrl)) return null;
    const root = path.resolve(repoUrl.replace(/^file:\/\//, ""));
    dirs.unshift(root);
    try {
      const { stdout } = await git(["remote", "get-url", "origin"], { cwd: root });
      remote = stdout.trim();
    } catch {
      return null;
    }
  }
  if (!parseGithubRepo(remote)) return null;
  for (const dir of dirs) {
    const branch = await branchPointingAt(dir, sha);
    if (branch && safeGitPath(branch)) return { repoUrl: remote, ref: branch };
  }
  return { repoUrl: remote, ref: sha };
}

function mirrorDirFor(cacheDir: string, repoUrl: string): string {
  const hash = createHash("sha1").update(repoUrl).digest("hex").slice(0, 12);
  return path.join(cacheDir, `mirror-${hash}`);
}

export async function ensureConfigCheckout(input: {
  repoUrl: string;
  token?: string;
  cacheDir: string;
  sha?: string;
}): Promise<{ dir: string; sha: string }> {
  const cacheDir = path.resolve(input.cacheDir);
  const mirror = mirrorDirFor(cacheDir, input.repoUrl);
  await mkdir(cacheDir, { recursive: true });
  const url = isLocalPath(input.repoUrl)
    ? input.repoUrl.replace(/^file:\/\//, "")
    : publicGitUrl(input.repoUrl);
  const token = isLocalPath(input.repoUrl) ? undefined : input.token;

  if (!(await exists(path.join(mirror, ".git")))) {
    await mkdir(path.dirname(mirror), { recursive: true });
    if (!(await exists(mirror))) {
      await git(["clone", url, mirror], { token });
    }
  } else {
    try {
      await git(["remote", "set-url", "origin", url], { cwd: mirror });
      await git(["fetch", "origin"], { cwd: mirror, token });
    } catch {
      // local path with no remote: fine
    }
  }

  let sha = input.sha?.trim();
  if (!sha) {
    try {
      const { stdout } = await exec("git", ["rev-parse", "origin/HEAD"], { cwd: mirror });
      sha = stdout.trim();
    } catch {
      const { stdout } = await exec("git", ["rev-parse", "HEAD"], { cwd: mirror });
      sha = stdout.trim();
    }
  }

  const checkoutDir = path.join(cacheDir, "checkouts", sha);
  const agentsPath = path.join(checkoutDir, "agents");
  if (!(await exists(agentsPath))) {
    const { rm } = await import("node:fs/promises");
    await rm(checkoutDir, { recursive: true, force: true });
    await mkdir(path.dirname(checkoutDir), { recursive: true });
    try {
      await exec("git", ["worktree", "add", "--detach", checkoutDir, sha], { cwd: mirror });
    } catch {
      await rm(checkoutDir, { recursive: true, force: true });
      await exec("git", ["clone", "--no-checkout", mirror, checkoutDir]);
      await exec("git", ["checkout", "--detach", sha], { cwd: checkoutDir });
    }
  }

  if (!(await exists(agentsPath))) {
    throw new Error("config repo has no agents");
  }

  return { dir: checkoutDir, sha };
}
