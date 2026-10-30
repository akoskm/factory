import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { prepareWorkspace } from "./workspace.js";

const exec = promisify(execFile);

async function git(cwd: string, args: string[]) {
  await exec("git", args, { cwd });
}

test("prepareWorkspace uses the remote work branch when it exists", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "factory-ws-"));
  const prev = process.env.WORKSPACES_DIR;
  process.env.WORKSPACES_DIR = path.join(root, "workspaces");
  try {
    const remote = path.join(root, "remote.git");
    const seed = path.join(root, "seed");
    await exec("git", ["init", "--bare", remote]);
    await exec("git", ["init", seed]);
    await git(seed, ["config", "user.email", "factory@localhost"]);
    await git(seed, ["config", "user.name", "factory-bot"]);
    await writeFile(path.join(seed, "f.txt"), "base\n");
    await git(seed, ["add", "f.txt"]);
    await git(seed, ["commit", "-m", "base"]);
    await git(seed, ["branch", "-M", "main"]);
    await git(seed, ["remote", "add", "origin", remote]);
    await git(seed, ["push", "-u", "origin", "main"]);
    await git(seed, ["checkout", "-b", "factory/1"]);
    await writeFile(path.join(seed, "g.txt"), "feature\n");
    await git(seed, ["add", "g.txt"]);
    await git(seed, ["commit", "-m", "feature"]);
    await git(seed, ["push", "-u", "origin", "factory/1"]);
    const { stdout: remoteTip } = await exec("git", ["rev-parse", "factory/1"], { cwd: seed });

    const cwd = await prepareWorkspace({
      runId: "run-1",
      repoUrl: remote,
      token: "unused",
      branch: "factory/1",
      baseBranch: "main",
    });

    const { stdout: head } = await exec("git", ["rev-parse", "HEAD"], { cwd });
    assert.equal(head.trim(), remoteTip.trim());
    const { stdout: branch } = await exec("git", ["branch", "--show-current"], { cwd });
    assert.equal(branch.trim(), "factory/1");

    const fresh = await prepareWorkspace({
      runId: "run-2",
      repoUrl: remote,
      token: "unused",
      branch: "factory/new",
      baseBranch: "main",
    });
    const { stdout: freshBranch } = await exec("git", ["branch", "--show-current"], { cwd: fresh });
    assert.equal(freshBranch.trim(), "factory/new");
    const { stdout: freshHead } = await exec("git", ["rev-parse", "HEAD"], { cwd: fresh });
    const { stdout: mainTip } = await exec("git", ["rev-parse", "main"], { cwd: seed });
    assert.equal(freshHead.trim(), mainTip.trim());
  } finally {
    if (prev === undefined) delete process.env.WORKSPACES_DIR;
    else process.env.WORKSPACES_DIR = prev;
    await rm(root, { recursive: true, force: true });
  }
});
