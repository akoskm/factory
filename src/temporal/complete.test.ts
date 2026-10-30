import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsePipeline } from "../config/load.js";
import { planOnComplete } from "./complete.js";

describe("planOnComplete", () => {
  it("keeps merge, then close, then later agents in config order", () => {
    assert.deepEqual(planOnComplete(["mergeProduct", "closeIssue", "monitor"]), [
      { kind: "skip", name: "mergeProduct" },
      { kind: "closeIssue" },
      { kind: "agent", name: "monitor" },
    ]);
  });

  it("treats any other name as an agent step", () => {
    assert.deepEqual(planOnComplete(["closeIssue", "reflect"]), [
      { kind: "closeIssue" },
      { kind: "agent", name: "reflect" },
    ]);
  });
});

describe("parsePipeline onComplete default", () => {
  it("closes the source issue after merge and before monitor", () => {
    assert.deepEqual(parsePipeline("").onComplete, ["mergeProduct", "closeIssue", "monitor"]);
  });
});
