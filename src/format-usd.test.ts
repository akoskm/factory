import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatUsd } from "./web/format-usd.js";

describe("formatUsd", () => {
  it("formats stored numeric strings", () => {
    assert.equal(formatUsd("1.500000"), "$1.50");
  });

  it("keeps sub-cent amounts visible", () => {
    assert.equal(formatUsd(0.00125), "$0.0013");
  });

  it("shows zero", () => {
    assert.equal(formatUsd(0), "$0.00");
    assert.equal(formatUsd("0.000000"), "$0.00");
  });

  it("hides missing cost", () => {
    assert.equal(formatUsd(null), null);
    assert.equal(formatUsd(""), null);
  });
});
