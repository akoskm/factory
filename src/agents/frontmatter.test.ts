import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { updateAgentHarnessModel } from "./frontmatter.js";
import { parseFrontmatter } from "./loader.js";

describe("updateAgentHarnessModel", () => {
  it("updates harness and model and keeps body", () => {
    const raw = `---
description: Spec writer
agentType: SPEC
harness: cursor
model: composer-2
---

Write a spec.
`;
    const out = updateAgentHarnessModel(raw, "local", "qwen-small");
    const { data, body } = parseFrontmatter(out);
    assert.equal(data.harness, "local");
    assert.equal(data.model, "qwen-small");
    assert.equal(data.description, "Spec writer");
    assert.equal(body, "Write a spec.");
  });

  it("adds frontmatter when missing", () => {
    const out = updateAgentHarnessModel("# hello", "cursor", "composer-2");
    const { data, body } = parseFrontmatter(out);
    assert.equal(data.harness, "cursor");
    assert.equal(data.model, "composer-2");
    assert.equal(body, "# hello");
  });
});