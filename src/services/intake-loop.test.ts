import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createIntakeLoop } from "./intake-loop.js";

describe("createIntakeLoop", () => {
  it("skips a tick while a previous pass is still running", async () => {
    let runs = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const loop = createIntakeLoop({
      intervalMs: 10,
      runPass: async () => {
        runs += 1;
        if (runs === 1) await gate;
        return { started: 0, repaired: 0 };
      },
    });

    loop.start();
    await new Promise((r) => setTimeout(r, 35));
    assert.equal(runs, 1, "second tick must not start while first is in flight");
    release();
    await new Promise((r) => setTimeout(r, 40));
    loop.stop();
    assert.ok(runs >= 2, "later ticks run after the first finishes");
  });
});
