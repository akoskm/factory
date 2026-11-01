import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";
import { promisify } from "node:util";
import { agentConfigFileUrl, configEditTarget, configMirrorDir, githubFileEditUrl } from "./checkout.js";

const exec = promisify(execFile);
const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "test",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "test",
  GIT_COMMITTER_EMAIL: "t@example.com",
};

describe("agentConfigFileUrl", () => {
  it("links a GitHub config repo at the loaded sha", () => {
    assert.equal(
      agentConfigFileUrl("https://github.com/akoskm/factory-config.git", "abc123", "monitor"),
      "https://github.com/akoskm/factory-config/blob/abc123/agents/monitor/agent.md",
    );
  });

  it("links a local config repo in Cursor", () => {
    assert.equal(
      agentConfigFileUrl("/Users/akoskm/Projects/factory-config", "ignored", "monitor"),
      "cursor://file/Users/akoskm/Projects/factory-config/agents/monitor/agent.md",
    );
  });

  it("returns null for an unknown host", () => {
    assert.equal(agentConfigFileUrl("https://gitlab.com/a/b", "abc", "monitor"), null);
  });
});

describe("githubFileEditUrl", () => {
  it("opens the file in GitHub edit mode at the loaded sha", () => {
    assert.equal(
      githubFileEditUrl(
        "https://github.com/akoskm/factory-config.git",
        "abc1234",
        "pipeline.yaml",
      ),
      "https://github.com/akoskm/factory-config/edit/abc1234/pipeline.yaml",
    );
  });

  it("keeps a slash branch and the agent path", () => {
    assert.equal(
      githubFileEditUrl(
        "git@github.com:akoskm/factory-config.git",
        "factory/learn-1",
        "agents/monitor/agent.md",
      ),
      "https://github.com/akoskm/factory-config/edit/factory/learn-1/agents/monitor/agent.md",
    );
  });

  it("returns null unless the repo and path are safe", () => {
    assert.equal(githubFileEditUrl("/tmp/factory-config", "abc1234", "pipeline.yaml"), null);
    assert.equal(
      githubFileEditUrl("https://github.com/akoskm/factory-config", "abc1234", "../pipeline.yaml"),
      null,
    );
  });
});

describe("configEditTarget", () => {
  it("uses the GitHub origin and branch of a local checkout", async () => {
    const dir = await mkdtemp(`${tmpdir()}/factory-config-`);
    try {
      await exec("git", ["init", "-b", "factory/learn-1"], { cwd: dir, env: gitEnv });
      await exec(
        "git",
        ["remote", "add", "origin", "https://github.com/akoskm/factory-config.git"],
        { cwd: dir, env: gitEnv },
      );
      await exec("git", ["commit", "--allow-empty", "-m", "init"], { cwd: dir, env: gitEnv });
      const { stdout } = await exec("git", ["rev-parse", "HEAD"], { cwd: dir, env: gitEnv });
      assert.deepEqual(await configEditTarget(dir, stdout.trim()), {
        repoUrl: "https://github.com/akoskm/factory-config.git",
        ref: "factory/learn-1",
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps the sha when no branch tip matches", async () => {
    const cache = await mkdtemp(`${tmpdir()}/factory-config-cache-`);
    try {
      assert.deepEqual(
        await configEditTarget("https://github.com/akoskm/factory-config.git", "abc1234", cache),
        { repoUrl: "https://github.com/akoskm/factory-config.git", ref: "abc1234" },
      );
    } finally {
      await rm(cache, { recursive: true, force: true });
    }
  });

  it("uses the mirrored remote branch when the config repo is a GitHub URL", async () => {
    const cache = await mkdtemp(`${tmpdir()}/factory-config-cache-`);
    const repoUrl = "https://github.com/akoskm/factory-config.git";
    const mirror = configMirrorDir(repoUrl, cache);
    try {
      await exec("git", ["init", "-b", "main", mirror], { env: gitEnv });
      await exec("git", ["commit", "--allow-empty", "-m", "init"], { cwd: mirror, env: gitEnv });
      const { stdout } = await exec("git", ["rev-parse", "HEAD"], { cwd: mirror, env: gitEnv });
      assert.deepEqual(await configEditTarget(repoUrl, stdout.trim(), cache), {
        repoUrl,
        ref: "main",
      });
    } finally {
      await rm(cache, { recursive: true, force: true });
    }
  });
});
