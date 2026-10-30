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
}): Promise<string> {
  const cwd = path.join(workspacesRoot(), input.runId);
  await rm(cwd, { recursive: true, force: true });
  await mkdir(cwd, { recursive: true });

  const authUrl = input.repoUrl.replace(
    "https://github.com/",
    `https://x-access-token:${input.token}@github.com/`,
  );

  await exec("git", ["clone", "--depth", "50", authUrl, cwd]);
  await exec("git", ["checkout", input.baseBranch], { cwd });

  if (input.branch) {
    try {
      await exec("git", ["fetch", "origin", input.branch], { cwd });
      await exec("git", ["checkout", "-B", input.branch, `origin/${input.branch}`], { cwd });
    } catch {
      await exec("git", ["checkout", "-B", input.branch], { cwd });
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
