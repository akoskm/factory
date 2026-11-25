import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDecision } from "./decision.js";

describe("parseDecision", () => {
  it("parses ask_user with options array", () => {
    assert.deepEqual(
      parseDecision(`decision:
  action: ask_user
  note: Which header copy?
  options:
    - "{N} of {Y} slots in use"
    - Keep "running" wording
    - Hide when idle
`),
      {
        action: "ask_user",
        note: "Which header copy?",
        options: [
          "{N} of {Y} slots in use",
          'Keep "running" wording',
          "Hide when idle",
        ],
      },
    );
  });

  it("parses ask_user from a fenced yaml block", () => {
    const transcript = `
Some prose.

\`\`\`yaml
decision:
  action: ask_user
  note: Pick one
  options:
    - A
    - B
\`\`\`
`;
    assert.deepEqual(parseDecision(transcript), {
      action: "ask_user",
      note: "Pick one",
      options: ["A", "B"],
    });
  });

  it("prefers the last decision block", () => {
    const transcript = `
decision:
  action: spawn
  agent: implement
decision:
  action: ask_user
  note: open questions remain
  options:
    - yes
    - no
`;
    assert.deepEqual(parseDecision(transcript), {
      action: "ask_user",
      note: "open questions remain",
      options: ["yes", "no"],
    });
  });
});
