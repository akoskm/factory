import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { agentConfigFileUrl } from "./checkout.js";

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
