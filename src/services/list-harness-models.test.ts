import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  harnessKeyName,
  isHarness,
  modelSelectOptions,
  pickModelOnHarnessChange,
  sortModelIds,
} from "./list-harness-models.js";

describe("list-harness-models helpers", () => {
  it("harnessKeyName maps harness to secret env names", () => {
    assert.equal(harnessKeyName("cursor"), "CURSOR_API_KEY");
    assert.equal(harnessKeyName("claude-code"), "ANTHROPIC_API_KEY");
    assert.equal(harnessKeyName("local"), "LOCAL_API_KEY");
  });

  it("isHarness accepts known harness values", () => {
    assert.equal(isHarness("cursor"), true);
    assert.equal(isHarness("claude-code"), true);
    assert.equal(isHarness("local"), true);
    assert.equal(isHarness("other"), false);
  });

  it("sortModelIds dedupes and sorts alphabetically", () => {
    assert.deepEqual(sortModelIds(["b", "a", "b", ""]), ["a", "b"]);
  });

  it("modelSelectOptions keeps current when absent from list", () => {
    assert.deepEqual(modelSelectOptions(["a", "b"], "legacy"), ["legacy", "a", "b"]);
    assert.deepEqual(modelSelectOptions(["a", "b"], "a"), ["a", "b"]);
    assert.deepEqual(modelSelectOptions([], "legacy"), ["legacy"]);
  });

  it("pickModelOnHarnessChange preserves valid model or picks first", () => {
    assert.equal(pickModelOnHarnessChange(["a", "b"], "b"), "b");
    assert.equal(pickModelOnHarnessChange(["a", "b"], "z"), "a");
    assert.equal(pickModelOnHarnessChange([], "z"), "z");
  });
});
