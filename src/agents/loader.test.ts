import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { loadAgentsFromDir } from "./loader.js";

describe("loadAgentsFromDir harness", () => {
  it("keeps local and falls back when the harness name is unknown", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agents-"));
    await mkdir(path.join(root, "local-one"));
    await mkdir(path.join(root, "weird"));
    await writeFile(
      path.join(root, "local-one", "agent.md"),
      "---\nharness: local\nmodel: qwen\n---\nDo the work.\n",
    );
    await writeFile(
      path.join(root, "weird", "agent.md"),
      "---\nharness: nope\n---\nNo.\n",
    );

    const agents = await loadAgentsFromDir(root);
    const local = agents.find((agent) => agent.name === "local-one");
    const weird = agents.find((agent) => agent.name === "weird");
    assert.equal(local?.harness, "local");
    assert.equal(local?.model, "qwen");
    assert.equal(weird?.harness, "cursor");
  });
});
