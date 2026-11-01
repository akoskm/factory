import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { githubAuthEnv, publicGitUrl } from "./auth.js";
import { prepareWorkspace } from "./workspace.js";

const token = "github_pat_EXAMPLE_SECRETVALUE";

test("public git urls drop embedded credentials", () => {
  assert.equal(
    publicGitUrl("https://x-access-token:github_pat_SECRET@github.com/acme/repo.git"),
    "https://github.com/acme/repo.git",
  );
  assert.equal(publicGitUrl("https://github.com/acme/repo"), "https://github.com/acme/repo");
  assert.equal(publicGitUrl("/tmp/local-repo"), "/tmp/local-repo");
});

test("github auth stays in the environment, not the command", () => {
  const env = githubAuthEnv(token, { PATH: "/usr/bin" });
  const dumped = Object.entries(env)
    .filter(([key]) => key !== "GIT_CONFIG_VALUE_0")
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  assert.equal(dumped.includes(token), false);
  assert.match(env.GIT_CONFIG_VALUE_0 ?? "", /^AUTHORIZATION: basic /i);
});

test("prepareWorkspace does not put the token on the git command line", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "factory-git-auth-"));
  const bin = path.join(root, "bin");
  const log = path.join(root, "args");
  const prevPath = process.env.PATH;
  const prevWorkspaces = process.env.WORKSPACES_DIR;
  process.env.WORKSPACES_DIR = path.join(root, "workspaces");
  await mkdir(bin);
  await writeFile(
    path.join(bin, "git"),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(log)}\nexit 1\n`,
  );
  await chmod(path.join(bin, "git"), 0o755);
  process.env.PATH = `${bin}${path.delimiter}${prevPath ?? ""}`;
  try {
    await assert.rejects(
      () =>
        prepareWorkspace({
          runId: "run-1",
          repoUrl: "https://github.com/acme/factory-config",
          token,
          baseBranch: "main",
        }),
      (err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        assert.equal(message.includes(token), false);
        assert.equal(message.includes("x-access-token:"), false);
        return true;
      },
    );
    const args = await readFile(log, "utf8");
    assert.equal(args.includes(token), false);
    assert.equal(args.includes("x-access-token:"), false);
    assert.match(args, /clone --depth 50 https:\/\/github.com\/acme\/factory-config/);
  } finally {
    if (prevPath === undefined) delete process.env.PATH;
    else process.env.PATH = prevPath;
    if (prevWorkspaces === undefined) delete process.env.WORKSPACES_DIR;
    else process.env.WORKSPACES_DIR = prevWorkspaces;
    await rm(root, { recursive: true, force: true });
  }
});
