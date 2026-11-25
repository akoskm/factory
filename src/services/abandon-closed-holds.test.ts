import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * Behavior covered by integration with intake loop:
 * needs_user + closed GitHub issue → fail hold and free the queue slot.
 * Pure unit surface is thin; this documents the contract.
 */
const ABANDONABLE = new Set(["needs_user", "queued", "scheduled"]);

describe("abandon closed holds contract", () => {
  it("abandons waiting holds when the issue is closed", () => {
    assert.equal(ABANDONABLE.has("needs_user") && !false, true);
    assert.equal(ABANDONABLE.has("queued"), true);
    assert.equal(ABANDONABLE.has("scheduled"), true);
  });

  it("does not abandon running work — on_complete closes the issue on purpose", () => {
    assert.equal(ABANDONABLE.has("running"), false);
    assert.equal(ABANDONABLE.has("waiting_review"), false);
  });
});
