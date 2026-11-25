import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDecision } from "./decision.js";

describe("parseDecision", () => {
  it("parses ask_user", () => {
    assert.deepEqual(
      parseDecision(`decision:\n  action: ask_user\n  note: what does X of Y mean?\n`),
      { action: "ask_user", agent: undefined, note: "what does X of Y mean?" },
    );
  });

  it("prefers the last decision block", () => {
    const transcript = `
decision:
  action: spawn
  agent: implement
decision:
  action: ask_user
  note: open questions remain
`;
    assert.deepEqual(parseDecision(transcript), {
      action: "ask_user",
      agent: undefined,
      note: "open questions remain",
    });
  });
});
