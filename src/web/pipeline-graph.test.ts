import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildPipelineGraph, type PipelineView } from "./pipeline-graph.js";

const pipeline: PipelineView = {
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

function labels(source: string) {
  return buildPipelineGraph(pipeline)
    .edges.filter((edge) => edge.source === source)
    .map((edge) => `${edge.label}→${edge.target}`)
    .sort();
}

describe("buildPipelineGraph", () => {
  it("spawns workspace agents from the foreman", () => {
    assert.deepEqual(labels("triage"), []);
    assert.deepEqual(labels("spec"), []);
    assert.ok(labels("foreman").includes("spawn→triage"));
    assert.ok(labels("foreman").includes("spawn→monitor"));
  });

  it("draws review, verify, and the onComplete chain from the config", () => {
    assert.deepEqual(labels("review"), ["revise→implement"]);
    assert.deepEqual(labels("verify"), ["fail→fail"]);
    assert.ok(labels("foreman").includes("complete→mergeProduct"));
    assert.deepEqual(labels("mergeProduct"), ["then→monitor"]);
  });

  it("inserts closeIssue between merge and monitor when the list has it", () => {
    const graph = buildPipelineGraph({
      ...pipeline,
      onComplete: ["mergeProduct", "closeIssue", "monitor"],
    });
    const edge = (source: string) =>
      graph.edges.filter((item) => item.source === source).map((item) => `${item.label}→${item.target}`);
    assert.ok(edge("foreman").includes("complete→mergeProduct"));
    assert.deepEqual(edge("mergeProduct"), ["then→closeIssue"]);
    assert.deepEqual(edge("closeIssue"), ["then→monitor"]);
    assert.equal(graph.nodes.find((node) => node.id === "closeIssue")?.kind, "step");
  });
});
