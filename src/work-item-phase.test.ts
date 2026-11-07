import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { intakeResume, recoverStart, settleReview } from "./work-item-phase.js";

describe("settleReview", () => {
  it("reruns the agent when a review asks for changes", () => {
    assert.deepEqual(
      settleReview({
        status: "waiting_review",
        decision: "request_changes",
        note: "Tighten the test",
        fallbackNote: "review wait timed out",
        revisionLoops: 0,
        revisionCap: 2,
      }),
      { kind: "revise", note: "Tighten the test", revisionLoops: 1 },
    );
  });

  it("stops a review once the revision cap is spent", () => {
    const settled = settleReview({
      status: "waiting_review",
      decision: "request_changes",
      fallbackNote: "review wait timed out",
      revisionLoops: 2,
      revisionCap: 2,
    });
    assert.equal(settled.kind, "stop");
  });

  it("stops a ship pause on request_changes and resumes it on approve", () => {
    assert.equal(
      settleReview({
        status: "needs_user",
        decision: "request_changes",
        note: "Drop it",
        fallbackNote: "merge blocked",
        revisionLoops: 0,
        revisionCap: 2,
      }).kind,
      "stop",
    );
    assert.deepEqual(
      settleReview({
        status: "needs_user",
        decision: "approve",
        fallbackNote: "merge blocked",
        revisionLoops: 0,
        revisionCap: 2,
      }),
      { kind: "continue" },
    );
  });

  it("stops when the signal never arrives", () => {
    assert.deepEqual(
      settleReview({
        status: "waiting_review",
        decision: null,
        fallbackNote: "review wait timed out",
        revisionLoops: 0,
        revisionCap: 2,
      }),
      { kind: "stop", error: "review wait timed out" },
    );
  });
});

describe("recoverStart", () => {
  it("resumes ship from the stored phase", () => {
    assert.deepEqual(
      recoverStart({ action: "retry_last", phase: "ship", agent: "verify" }),
      { phase: "ship", startAgent: "ship" },
    );
    assert.deepEqual(
      recoverStart({ action: "retry_last", phase: "integrate", agent: "implement" }),
      { phase: "integrate", startAgent: "implement" },
    );
  });

  it("retries the foreman from step and clears a reset", () => {
    assert.deepEqual(
      recoverStart({ action: "retry_foreman", phase: "ship", agent: "implement" }),
      { phase: "step", startAgent: "foreman" },
    );
    assert.deepEqual(
      recoverStart({ action: "reset_branch", phase: "recheck", agent: "verify" }),
      { phase: "step", startAgent: "foreman" },
    );
  });

  it("uses the current agent only for a step retry", () => {
    assert.deepEqual(
      recoverStart({ action: "retry_last", phase: "step", agent: "review" }),
      { phase: "step", startAgent: "review" },
    );
  });
});

describe("intakeResume", () => {
  it("finishes a merged item instead of starting the foreman", () => {
    assert.deepEqual(
      intakeResume({ status: "merged", phase: "step", currentAgent: "implement" }),
      { phase: "on_complete", startAgent: "ship" },
    );
  });

  it("restarts a dead running item at its phase", () => {
    assert.deepEqual(
      intakeResume({ status: "running", phase: "recheck", currentAgent: "verify" }),
      { phase: "recheck", startAgent: "verify" },
    );
  });

  it("re-enters a dead hold instead of shipping", () => {
    assert.deepEqual(
      intakeResume({ status: "needs_user", phase: "ship", currentAgent: "implement" }),
      { phase: "ship", startAgent: "ship", hold: "needs_user" },
    );
    assert.deepEqual(
      intakeResume({ status: "waiting_review", phase: "step", currentAgent: "review" }),
      { phase: "step", startAgent: "review", hold: "waiting_review" },
    );
  });
});
