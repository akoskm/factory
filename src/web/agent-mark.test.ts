import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { agentMark, agentTypeByName } from "./agent-mark.js";

describe("agentMark", () => {
  it("maps each agent type to a tone and icon", () => {
    assert.deepEqual(agentMark("FOREMAN"), { tone: "magenta", icon: "git-branch" });
    assert.deepEqual(agentMark("REVIEW"), { tone: "pink", icon: "messages" });
    assert.deepEqual(agentMark("IMPLEMENT"), { tone: "blue", icon: "code" });
    assert.deepEqual(agentMark("SPEC"), { tone: "orange", icon: "file" });
    assert.deepEqual(agentMark("TRIAGE"), { tone: "indigo", icon: "circle-dashed" });
    assert.deepEqual(agentMark("VERIFY"), { tone: "teal", icon: "check" });
    assert.deepEqual(agentMark("CUSTOM"), { tone: "slate", icon: "bot" });
  });

  it("accepts lowercase types and falls back to custom", () => {
    assert.deepEqual(agentMark("review"), agentMark("REVIEW"));
    assert.deepEqual(agentMark("unknown"), agentMark("CUSTOM"));
    assert.deepEqual(agentMark(null), agentMark("CUSTOM"));
    assert.deepEqual(agentMark(undefined), agentMark("CUSTOM"));
  });
});

describe("agentTypeByName", () => {
  it("indexes agent type by name", () => {
    const types = agentTypeByName([
      { name: "foreman", agentType: "FOREMAN" },
      { name: "implement", agentType: "IMPLEMENT" },
    ]);
    assert.equal(types.foreman, "FOREMAN");
    assert.equal(types.implement, "IMPLEMENT");
    assert.equal(types.missing, undefined);
  });
});
