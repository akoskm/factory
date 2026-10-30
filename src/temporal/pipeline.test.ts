import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PipelineConfig } from "../config/load.js";
import { nextStep } from "./pipeline.js";

const pipeline: PipelineConfig = {
  maxSteps: 40,
  startAgent: "foreman",
  revisionCap: 2,
  workspaceAgents: ["triage", "spec", "implement", "review", "verify", "monitor"],
  pushAgents: ["implement", "verify"],
  learnAgent: "monitor",
  routes: {
    review: { revise: "implement", default: "foreman" },
    verify: { fail: "fail", default: "foreman" },
    default: "foreman",
  },
  onComplete: ["mergeProduct", "monitor"],
};

describe("nextStep", () => {
  it("routes review revise under the cap to implement", () => {
    const step = nextStep({
      pipeline,
      agentName: "review",
      result: { reviewVerdict: "revise" },
      revisionLoops: 0,
    });
    assert.deepEqual(step, { kind: "spawn", agent: "implement", revisionLoops: 1 });
  });

  it("fails the item when verify fails", () => {
    const step = nextStep({
      pipeline,
      agentName: "verify",
      result: { verifyVerdict: "fail" },
      revisionLoops: 0,
    });
    assert.deepEqual(step, { kind: "fail", note: "verify failed" });
  });

  it("returns specialists to foreman", () => {
    const step = nextStep({
      pipeline,
      agentName: "triage",
      result: {},
      revisionLoops: 0,
    });
    assert.deepEqual(step, { kind: "spawn", agent: "foreman", revisionLoops: 0 });
  });
});
