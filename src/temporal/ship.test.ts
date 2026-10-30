import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyMergeGate, nextShipStep } from "./ship.js";

const base = {
  mergeable: false as boolean | null,
  mergeableState: "dirty",
  behindBy: 1,
  draft: false,
  base: "main",
  head: "factory/1",
  commits: ["feat: recover failed work"],
};

test("a branch behind main is an implement job", () => {
  const gate = classifyMergeGate(base);
  assert.equal(gate.state, "integrate");
  assert.match(gate.summary, /Merge main into factory\/1/);
  assert.match(gate.summary, /feat: recover failed work/);
  assert.deepEqual(nextShipStep(gate, 0), { action: "integrate", note: gate.summary });
});

test("a second conflict asks the user", () => {
  const gate = classifyMergeGate(base);
  assert.equal(nextShipStep(gate, 1).action, "ask_user");
});

test("a clean pull request merges", () => {
  const gate = classifyMergeGate({
    ...base,
    mergeable: true,
    mergeableState: "clean",
    behindBy: 0,
    commits: [],
  });
  assert.equal(gate.state, "ready");
  assert.deepEqual(nextShipStep(gate, 0), { action: "merge" });
});

test("branch protection asks the user even on the first try", () => {
  const gate = classifyMergeGate({ ...base, mergeableState: "blocked", behindBy: 0 });
  assert.equal(gate.state, "blocked");
  assert.equal(nextShipStep(gate, 0).action, "ask_user");
});
