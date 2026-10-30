import { execFile } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

export function workspacesRoot(): string {
  return process.env.WORKSPACES_DIR ?? path.resolve(process.cwd(), "workspaces");
}

export async function prepareWorkspace(input: {
  runId: string;
  repoUrl: string;
  token: string;
  branch?: string;
  baseBranch: string;
  /** Detach at this SHA after clone (factory-config pin). */
  sha?: string;
}): Promise<string> {
  const cwd = path.join(workspacesRoot(), input.runId);
  await rm(cwd, { recursive: true, force: true });
  await mkdir(cwd, { recursive: true });

  const local =
    input.repoUrl.startsWith("/") ||
    input.repoUrl.startsWith("./") ||
    input.repoUrl.startsWith("../") ||
    input.repoUrl.startsWith("file://")
      ? input.repoUrl.replace(/^file:\/\//, "")
      : null;

  const authUrl =
    local ??
    input.repoUrl.replace(
      "https://github.com/",
      `https://x-access-token:${input.token}@github.com/`,
    );

  await exec("git", ["clone", ...(local ? [] : ["--depth", "50"]), authUrl, cwd]);
  if (input.sha) {
    await exec("git", ["checkout", "--detach", input.sha], { cwd });
  } else {
    await exec("git", ["checkout", input.baseBranch], { cwd });
  }

  if (input.branch) {
    if (input.sha) {
      // Learn / pinned config: branch from the pinned SHA, ignore any prior remote branch.
      await exec("git", ["checkout", "-B", input.branch], { cwd });
    } else {
      // clone --depth implies --single-branch, so `git fetch origin <branch>`
      // only updates FETCH_HEAD. Map the ref explicitly or the next run
      // branches from main and the push is rejected as non-fast-forward.
      let hasRemote = false;
      try {
        await exec(
          "git",
          ["fetch", "origin", `+${input.branch}:refs/remotes/origin/${input.branch}`],
          { cwd },
        );
        hasRemote = true;
      } catch {
        hasRemote = false;
      }
      if (hasRemote) {
        await exec("git", ["checkout", "-B", input.branch, `origin/${input.branch}`], { cwd });
      } else {
        await exec("git", ["checkout", "-B", input.branch], { cwd });
      }
    }
  }

  await exec("git", ["config", "user.email", "factory@localhost"], { cwd });
  await exec("git", ["config", "user.name", "factory-bot"], { cwd });
  return cwd;
}

export async function commitAll(cwd: string, message: string): Promise<boolean> {
  await exec("git", ["add", "-A"], { cwd });
  try {
    await exec("git", ["diff", "--cached", "--quiet"], { cwd });
    return false;
  } catch {
    await exec("git", ["commit", "-m", message], { cwd });
    return true;
  }
}

export async function cleanupWorkspace(runId: string): Promise<void> {
  await rm(path.join(workspacesRoot(), runId), { recursive: true, force: true });
}
