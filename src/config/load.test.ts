import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, it, after } from "node:test";
import { ensureConfigCheckout } from "./checkout.js";
import { loadConfig } from "./load.js";

const exec = promisify(execFile);

async function seedConfigRepo(root: string): Promise<string> {
  await mkdir(path.join(root, "agents", "foreman"), { recursive: true });
  await writeFile(
    path.join(root, "pipeline.yaml"),
    `maxSteps: 40
startAgent: foreman
revisionCap: 2
workspaceAgents: [triage]
pushAgents: [implement]
learnAgent: monitor
routes:
  default: foreman
onComplete: [mergeProduct, monitor]
`,
  );
  await writeFile(
    path.join(root, "agents", "foreman", "agent.md"),
    `---
description: Coordinates
agentType: FOREMAN
harness: cursor
model: composer-2
idleTimeoutMinutes: 10
waitForReview: false
---

Foreman body A
`,
  );
  await exec("git", ["init"], { cwd: root });
  await exec("git", ["config", "user.email", "test@localhost"], { cwd: root });
  await exec("git", ["config", "user.name", "test"], { cwd: root });
  await exec("git", ["add", "-A"], { cwd: root });
  await exec("git", ["commit", "-m", "init"], { cwd: root });
  const { stdout } = await exec("git", ["rev-parse", "HEAD"], { cwd: root });
  return stdout.trim();
}

describe("loadConfig", () => {
  const dirs: string[] = [];
  after(async () => {
    for (const d of dirs) await rm(d, { recursive: true, force: true });
  });

  it("loads pipeline and waitForReview from a temp git repo", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "factory-config-"));
    dirs.push(root);
    await seedConfigRepo(root);
    const cache = await mkdtemp(path.join(tmpdir(), "factory-cache-"));
    dirs.push(cache);

    const { dir, sha } = await ensureConfigCheckout({
      repoUrl: root,
      cacheDir: cache,
    });
    assert.ok(sha.length >= 7);
    const config = await loadConfig(dir);
    assert.equal(config.pipeline.maxSteps, 40);
    assert.equal(config.pipeline.startAgent, "foreman");
    const foreman = config.agents.find((a) => a.name === "foreman");
    assert.ok(foreman);
    assert.equal(foreman.waitForReview, false);
    assert.match(foreman.instructions, /Foreman body A/);
  });

  it("keeps a pinned SHA after the default branch moves", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "factory-config-"));
    dirs.push(root);
    const shaA = await seedConfigRepo(root);
    const cache = await mkdtemp(path.join(tmpdir(), "factory-cache-"));
    dirs.push(cache);

    await ensureConfigCheckout({ repoUrl: root, cacheDir: cache, sha: shaA });

    await writeFile(
      path.join(root, "agents", "foreman", "agent.md"),
      `---
description: Coordinates
agentType: FOREMAN
harness: cursor
model: composer-2
waitForReview: false
---

Foreman body B
`,
    );
    await exec("git", ["add", "-A"], { cwd: root });
    await exec("git", ["commit", "-m", "update"], { cwd: root });

    const pinned = await ensureConfigCheckout({
      repoUrl: root,
      cacheDir: cache,
      sha: shaA,
    });
    const configA = await loadConfig(pinned.dir);
    assert.match(configA.agents.find((a) => a.name === "foreman")!.instructions, /Foreman body A/);

    const latest = await ensureConfigCheckout({ repoUrl: root, cacheDir: cache });
    const configB = await loadConfig(latest.dir);
    assert.match(configB.agents.find((a) => a.name === "foreman")!.instructions, /Foreman body B/);
    assert.notEqual(latest.sha, shaA);
  });
});
