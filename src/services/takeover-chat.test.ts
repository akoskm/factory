import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resumeFromSteerDecision } from "./takeover-chat.js";

describe("resumeFromSteerDecision", () => {
  it("fails with the decision note", () => {
    assert.deepEqual(
      resumeFromSteerDecision({
        decision: { action: "fail", note: "blocked" },
        phase: "step",
        integrateAttempts: 1,
        revisionLoops: 2,
      }),
      { kind: "fail", error: "blocked" },
    );
  });

  it("maps complete to ship without wiping counters", () => {
    assert.deepEqual(
      resumeFromSteerDecision({
        decision: { action: "complete", note: "done" },
        phase: "step",
        integrateAttempts: 1,
        revisionLoops: 2,
      }),
      {
        kind: "start",
        phase: "ship",
        startAgent: "ship",
        integrateAttempts: 1,
        revisionLoops: 2,
      },
    );
  });

  it("spawns the named agent on step", () => {
    assert.deepEqual(
      resumeFromSteerDecision({
        decision: { action: "spawn", agent: "implement" },
        phase: "step",
        integrateAttempts: 0,
        revisionLoops: 1,
      }),
      {
        kind: "start",
        phase: "step",
        startAgent: "implement",
        integrateAttempts: 0,
        revisionLoops: 1,
      },
    );
  });

  it("preserves integrate phase and counters", () => {
    assert.deepEqual(
      resumeFromSteerDecision({
        decision: { action: "spawn", agent: "implement" },
        phase: "integrate",
        integrateAttempts: 3,
        revisionLoops: 1,
      }),
      {
        kind: "start",
        phase: "integrate",
        startAgent: "implement",
        integrateAttempts: 3,
        revisionLoops: 1,
      },
    );
  });

  it("preserves recheck phase", () => {
    assert.deepEqual(
      resumeFromSteerDecision({
        decision: { action: "spawn", agent: "verify" },
        phase: "recheck",
        integrateAttempts: 2,
        revisionLoops: 0,
      }),
      {
        kind: "start",
        phase: "recheck",
        startAgent: "verify",
        integrateAttempts: 2,
        revisionLoops: 0,
      },
    );
  });

  it("rejects spawn without an agent", () => {
    assert.deepEqual(
      resumeFromSteerDecision({
        decision: { action: "spawn" },
        phase: "step",
        integrateAttempts: 0,
        revisionLoops: 0,
      }),
      { kind: "fail", error: "foreman spawn returned no agent" },
    );
  });
});
