import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  displayError,
  runHeadline,
  runIdForNote,
  runsOverview,
  type RunFact,
} from "./work-item-overview.js";

function run(partial: Partial<RunFact> & Pick<RunFact, "agentName" | "startedAt">): RunFact {
  return {
    status: "finished",
    transcript: "",
    decision: null,
    ...partial,
  };
}

describe("runIdForNote", () => {
  const runs = [
    { id: "t1", agentName: "triage", startedAt: "2026-10-31T06:32:00.000Z" },
    { id: "t2", agentName: "triage", startedAt: "2026-10-31T06:40:00.000Z" },
    { id: "s1", agentName: "spec", startedAt: "2026-10-31T06:33:00.000Z" },
  ];

  it("keeps the note on the step that stored it", () => {
    assert.equal(runIdForNote({ kind: "triage", runId: "t1" }, runs), "t1");
  });

  it("falls back to the latest step of that name", () => {
    assert.equal(runIdForNote({ kind: "triage" }, runs), "t2");
    assert.equal(runIdForNote({ kind: "review" }, runs), null);
  });
});

describe("runsOverview", () => {
  it("tells the handoff story and skips foreman spawns that the next run fulfills", () => {
    const runs: RunFact[] = [
      run({
        agentName: "foreman",
        startedAt: "2026-10-31T06:32:00.000Z",
        decision: { action: "spawn", agent: "triage", note: "New issue." },
      }),
      run({ agentName: "triage", startedAt: "2026-10-31T06:32:42.000Z" }),
      run({
        agentName: "foreman",
        startedAt: "2026-10-31T06:33:00.000Z",
        decision: { action: "spawn", agent: "spec" },
      }),
      run({ agentName: "spec", startedAt: "2026-10-31T06:33:17.000Z" }),
      run({
        agentName: "foreman",
        startedAt: "2026-10-31T06:33:40.000Z",
        decision: { action: "spawn", agent: "implement" },
      }),
      run({ agentName: "implement", startedAt: "2026-10-31T06:33:51.000Z" }),
      run({
        agentName: "foreman",
        startedAt: "2026-10-31T06:35:00.000Z",
        decision: { action: "spawn", agent: "review" },
      }),
      run({
        agentName: "review",
        startedAt: "2026-10-31T06:35:10.000Z",
        transcript: "verdict: revise",
      }),
      run({ agentName: "implement", startedAt: "2026-10-31T06:36:05.000Z" }),
      run({
        agentName: "foreman",
        startedAt: "2026-10-31T06:37:00.000Z",
        decision: { action: "spawn", agent: "review" },
      }),
      run({
        agentName: "review",
        startedAt: "2026-10-31T06:37:41.000Z",
        transcript: "verdict: accept",
      }),
      run({
        agentName: "foreman",
        startedAt: "2026-10-31T06:38:00.000Z",
        decision: { action: "spawn", agent: "verify" },
      }),
      run({
        agentName: "verify",
        startedAt: "2026-10-31T06:38:38.000Z",
        transcript: "verdict: accept",
      }),
      run({
        agentName: "foreman",
        startedAt: "2026-10-31T06:39:00.000Z",
        decision: { action: "complete", note: "Verify accepted." },
      }),
      run({ agentName: "monitor", status: "error", startedAt: "2026-10-31T06:40:00.000Z" }),
    ];
    assert.equal(
      runsOverview(runs),
      "15 runs. Triage classified the request. Spec wrote the plan. Implement changed the code. Review asked for a revision. Implement addressed the review. Review accepted. Verify passed. Foreman closed the work. Monitor failed.",
    );
  });

  it("keeps a spawn that nobody followed", () => {
    assert.equal(
      runsOverview([
        run({
          agentName: "foreman",
          startedAt: "2026-10-31T06:32:00.000Z",
          decision: { action: "spawn", agent: "triage" },
        }),
      ]),
      "1 run. Foreman sent this to triage.",
    );
  });

  it("covers an item with no runs", () => {
    assert.equal(runsOverview([]), "No agents have run on this item yet.");
  });
});

describe("runHeadline", () => {
  it("prefers the decision note", () => {
    assert.equal(
      runHeadline(
        run({
          agentName: "foreman",
          startedAt: "2026-10-31T06:32:00.000Z",
          decision: { action: "spawn", agent: "triage", note: "New issue; start with triage." },
        }),
      ),
      "New issue; start with triage.",
    );
  });

  it("skips the process opener and a generic heading", () => {
    assert.equal(
      runHeadline(
        run({
          agentName: "implement",
          startedAt: "2026-10-31T06:33:51.000Z",
          transcript: [
            "Implementing the Runs page filter.",
            "## Summary",
            "Added a searchable work-item combobox on the Runs page.",
          ].join("\n"),
        }),
      ),
      "Added a searchable work-item combobox on the Runs page.",
    );
  });

  it("uses a specific heading", () => {
    assert.equal(
      runHeadline(
        run({
          agentName: "triage",
          startedAt: "2026-10-31T06:32:42.000Z",
          transcript: "Triageing the work item.\n## Triage: filter Runs by Work item ([#5](https://example.com))",
        }),
      ),
      "Triage: filter Runs by Work item (#5)",
    );
  });

  it("states a review verdict", () => {
    assert.equal(
      runHeadline(
        run({
          agentName: "review",
          startedAt: "2026-10-31T06:35:10.000Z",
          transcript: "Reviewing the diff.\nverdict: revise",
        }),
      ),
      "Asked for a revision.",
    );
  });

  it("redacts tokens and prefers the fatal line", () => {
    const headline = runHeadline(
      run({
        agentName: "monitor",
        status: "error",
        startedAt: "2026-10-31T06:40:00.000Z",
        error: [
          "Command failed: git clone https://x-access-token:github_pat_11AAXXVSY09sBEUOdn1zdn_SECRET@github.com/akoskm/factory-config",
          "remote: Write access to repository not granted.",
          "fatal: unable to access 'https://github.com/akoskm/factory-config/': The requested URL returned error: 403",
        ].join("\n"),
      }),
    );
    assert.equal(headline, "fatal: unable to access 'https://github.com/akoskm/factory-config/': The requested URL returned error: 403");
    assert.equal(headline.includes("github_pat_"), false);
    assert.equal(headline.includes("SECRET"), false);
    assert.equal(displayError("ghp_abc123").includes("ghp_"), false);
  });
});
