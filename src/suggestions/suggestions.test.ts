import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { groupFindings } from "./group.js";
import { judgeSuggestionMatch } from "./judge.js";
import {
  judgePrompt,
  learnFindingsInstructions,
  parseJudgeMatch,
  parseSuggestionFindings,
  type SuggestionFinding,
} from "./findings.js";

function finding(patch: Partial<SuggestionFinding> = {}): SuggestionFinding {
  return {
    title: "Let triage start research subagents",
    summary: "Triage investigates inline because it cannot spawn.",
    problem: "Triage has no spawn permission.",
    solution: "Declare triage spawnable.",
    agent: "triage",
    runIds: ["run-1"],
    ...patch,
  };
}

describe("parseSuggestionFindings", () => {
  it("reads a suggestions fence", () => {
    const transcript = [
      "edited agents/triage/agent.md",
      "```artifact:suggestions",
      JSON.stringify([
        finding(),
        { title: "skip", problem: "" },
        { title: "Second", problem: "Another", runIds: ["run-2", "run-2", 4] },
      ]),
      "```",
    ].join("\n");
    const rows = parseSuggestionFindings(transcript);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].agent, "triage");
    assert.deepEqual(rows[1].runIds, ["run-2"]);
  });

  it("returns nothing when the fence is missing or invalid", () => {
    assert.deepEqual(parseSuggestionFindings("no fence"), []);
    assert.deepEqual(parseSuggestionFindings("```artifact:suggestions\nnot-json\n```"), []);
  });
});

describe("parseJudgeMatch", () => {
  const allowed = new Set(["s1"]);

  it("accepts a known id and rejects anything else", () => {
    assert.equal(parseJudgeMatch('{"matchId":"s1"}', allowed), "s1");
    assert.equal(parseJudgeMatch('note {"matchId":null}', allowed), null);
    assert.equal(parseJudgeMatch('{"matchId":"other"}', allowed), null);
    assert.equal(parseJudgeMatch("no json", allowed), null);
  });
});

describe("groupFindings", () => {
  it("updates an existing suggestion when the judge matches it", async () => {
    const actions = await groupFindings(
      [finding({ title: "Again" })],
      [{ id: "s1", title: "Old", summary: "", problem: "p", agent: "triage" }],
      async () => "s1",
    );
    assert.equal(actions.length, 1);
    assert.equal(actions[0].type, "update");
    assert.equal(actions[0].suggestionId, "s1");
  });

  it("lets a later finding match one created earlier in the batch", async () => {
    const actions = await groupFindings(
      [finding({ title: "A" }), finding({ title: "A again" })],
      [],
      async (_finding, open) => (open.length ? open[0].id : null),
    );
    assert.equal(actions[0].type, "create");
    assert.equal(actions[1].type, "update");
    assert.equal(actions[1].suggestionId, actions[0].suggestionId);
  });

  it("creates when the judge returns an unknown id", async () => {
    const actions = await groupFindings(
      [finding()],
      [{ id: "s1", title: "Old", summary: "", problem: "p", agent: null }],
      async () => "missing",
    );
    assert.equal(actions[0].type, "create");
    assert.notEqual(actions[0].suggestionId, "missing");
  });
});

describe("judgeSuggestionMatch", () => {
  it("uses the named harness and returns null when that harness is unknown", async () => {
    const id = await judgeSuggestionMatch({
      harness: "not-a-harness",
      model: "some-model",
      finding: finding(),
      open: [{ id: "s1", title: "Old", summary: "", problem: "p", agent: null }],
    });
    assert.equal(id, null);
  });
});

describe("prompts", () => {
  it("lists failed run ids and tells the learn agent not to group", () => {
    const text = learnFindingsInstructions([
      { id: "run-9", agentName: "triage", error: "no spawn" },
    ]);
    assert.match(text, /run-9/);
    assert.match(text, /Do not decide whether a problem is new/);
  });

  it("asks the judge for a match id", () => {
    const text = judgePrompt(finding(), [
      { id: "s1", title: "Old", summary: "sum", problem: "prob", agent: "triage" },
    ]);
    assert.match(text, /"matchId"/);
    assert.match(text, /id: s1/);
  });
});
