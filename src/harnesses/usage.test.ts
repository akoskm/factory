import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseClaudeResult, resolveCursorUsage, usdFromCursorCost } from "./usage.js";

describe("usdFromCursorCost", () => {
  it("converts raw model cents to dollars", () => {
    assert.equal(usdFromCursorCost({ rawCostCents: 12.5, chargedCents: 0 }), 0.125);
  });

  it("uses charged cents when raw model cost is zero", () => {
    assert.equal(usdFromCursorCost({ rawCostCents: 0, chargedCents: 40 }), 0.4);
  });

  it("returns 0 when both cent fields are 0", () => {
    assert.equal(usdFromCursorCost({ rawCostCents: 0, chargedCents: 0 }), 0);
  });

  it("returns undefined when cost is missing", () => {
    assert.equal(usdFromCursorCost(undefined), undefined);
  });
});

describe("resolveCursorUsage", () => {
  it("waits until cost lands after the run", async () => {
    let calls = 0;
    const usage = await resolveCursorUsage(
      async () => {
        calls += 1;
        if (calls === 1) {
          return { usage: { inputTokens: 10, outputTokens: 4 } };
        }
        return {
          usage: { inputTokens: 10, outputTokens: 4 },
          cost: { rawCostCents: 8, chargedCents: 8 },
        };
      },
      undefined,
      { wait: async () => undefined },
    );
    assert.equal(calls, 2);
    assert.deepEqual(usage, { inputTokens: 10, outputTokens: 4, costUsd: 0.08 });
  });

  it("keeps token usage when getUsage throws", async () => {
    const usage = await resolveCursorUsage(
      async () => {
        throw new Error("offline");
      },
      { inputTokens: 3, outputTokens: 1 },
      { wait: async () => undefined },
    );
    assert.deepEqual(usage, { inputTokens: 3, outputTokens: 1 });
  });
});

describe("parseClaudeResult", () => {
  it("reads transcript and total cost from json output", () => {
    const parsed = parseClaudeResult(
      JSON.stringify({
        result: "done",
        total_cost_usd: 0.42,
        usage: { input_tokens: 100, output_tokens: 20 },
      }),
    );
    assert.equal(parsed.transcript, "done");
    assert.deepEqual(parsed.usage, { inputTokens: 100, outputTokens: 20, costUsd: 0.42 });
  });

  it("keeps plain text when output is not json", () => {
    const parsed = parseClaudeResult("plain transcript");
    assert.equal(parsed.transcript, "plain transcript");
    assert.equal(parsed.usage, undefined);
  });
});
