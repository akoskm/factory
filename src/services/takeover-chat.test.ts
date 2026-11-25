import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDecision, resumeFromSteerDecision } from "./takeover-chat.js";

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

  it("parks ask_user without starting the pipeline", () => {
    assert.deepEqual(
      resumeFromSteerDecision({
        decision: {
          action: "ask_user",
          note: "What is X?",
          options: ["A", "B"],
        },
        phase: "step",
        integrateAttempts: 0,
        revisionLoops: 0,
      }),
      { kind: "ask_user", note: "What is X?", options: ["A", "B"] },
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

  it("maps complete with no PR to on_complete", () => {
    assert.deepEqual(
      resumeFromSteerDecision({
        decision: { action: "complete", note: "done" },
        phase: "step",
        integrateAttempts: 0,
        revisionLoops: 0,
        hasPullRequest: false,
      }),
      {
        kind: "start",
        phase: "on_complete",
        startAgent: "ship",
        integrateAttempts: 0,
        revisionLoops: 0,
      },
    );
  });

  it("keeps complete on on_complete instead of re-entering ship", () => {
    assert.deepEqual(
      resumeFromSteerDecision({
        decision: { action: "complete", note: "finish" },
        phase: "on_complete",
        integrateAttempts: 0,
        revisionLoops: 0,
        hasPullRequest: true,
      }),
      {
        kind: "start",
        phase: "on_complete",
        startAgent: "ship",
        integrateAttempts: 0,
        revisionLoops: 0,
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

  it("leaves ship phase so spawn runs the named agent", () => {
    assert.deepEqual(
      resumeFromSteerDecision({
        decision: { action: "spawn", agent: "implement" },
        phase: "ship",
        integrateAttempts: 1,
        revisionLoops: 0,
      }),
      {
        kind: "start",
        phase: "step",
        startAgent: "implement",
        integrateAttempts: 1,
        revisionLoops: 0,
      },
    );
  });

  it("leaves on_complete so spawn runs the named agent", () => {
    assert.deepEqual(
      resumeFromSteerDecision({
        decision: { action: "spawn", agent: "monitor" },
        phase: "on_complete",
        integrateAttempts: 0,
        revisionLoops: 0,
      }),
      {
        kind: "start",
        phase: "step",
        startAgent: "monitor",
        integrateAttempts: 0,
        revisionLoops: 0,
      },
    );
  });
});

describe("parseDecision", () => {
  it("uses the last decision yaml when an earlier example exists", () => {
    const transcript = `
Example:
\`\`\`yaml
decision:
  action: spawn
  agent: triage
\`\`\`

Real answer:
\`\`\`yaml
decision:
  action: complete
  note: ship it
\`\`\`
`;
    assert.deepEqual(parseDecision(transcript), {
      action: "complete",
      note: "ship it",
    });
  });

  it("parses indented decision blocks from the end", () => {
    const transcript = `Earlier:
decision:
  action: fail
  note: old

Final:
decision:
  action: spawn
  agent: implement
  note: go
`;
    assert.deepEqual(parseDecision(transcript), {
      action: "spawn",
      agent: "implement",
      note: "go",
    });
  });
});

