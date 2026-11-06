import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { applyAgentOverride } from "./override.js";

const agent = { harness: "cursor" as const, model: "composer-2", name: "implement" };

describe("applyAgentOverride", () => {
  it("keeps the agent when no override is set", () => {
    assert.equal(applyAgentOverride(agent, {}), agent);
  });

  it("replaces harness and model when both are set", () => {
    const next = applyAgentOverride(agent, { harness: "local", model: "qwen" });
    assert.equal(next.harness, "local");
    assert.equal(next.model, "qwen");
    assert.equal(next.name, "implement");
  });

  it("ignores an unknown harness and a blank model", () => {
    const next = applyAgentOverride(agent, { harness: "nope", model: "  " });
    assert.equal(next, agent);
  });
});
