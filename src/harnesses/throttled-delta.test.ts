import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createThrottledDelta } from "./throttled-delta.js";

describe("createThrottledDelta", () => {
  it("writes immediately on first delta then coalesces until flush", async () => {
    const writes: string[] = [];
    const { onDelta, flush } = createThrottledDelta((t) => {
      writes.push(t);
    }, 50);

    await onDelta("a");
    await onDelta("ab");
    await onDelta("abc");
    assert.deepEqual(writes, ["a"]);

    await new Promise((r) => setTimeout(r, 60));
    await flush();
    assert.ok(writes.includes("abc"));
    assert.ok(writes.length <= 3);
  });

  it("flush writes the last pending transcript", async () => {
    const writes: string[] = [];
    const { onDelta, flush } = createThrottledDelta((t) => {
      writes.push(t);
    }, 10_000);

    await onDelta("first");
    await onDelta("second");
    await flush();
    assert.deepEqual(writes, ["first", "second"]);
  });

  it("keeps writing after a failed write", async () => {
    const writes: string[] = [];
    const errors: unknown[] = [];
    const { onDelta, flush } = createThrottledDelta(
      (t) => {
        writes.push(t);
        if (t === "bad") throw new Error("db down");
      },
      10_000,
      (error) => errors.push(error),
    );

    await onDelta("bad");
    await onDelta("good");
    await flush();

    assert.deepEqual(writes, ["bad", "good"]);
    assert.equal(errors.length, 1);
  });

  it("reports timer flush failures without rejecting", async () => {
    const errors: unknown[] = [];
    const { onDelta } = createThrottledDelta(
      () => {
        throw new Error("db down");
      },
      10,
      (error) => errors.push(error),
    );

    await onDelta("first");
    await onDelta("second");
    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.equal(errors.length, 2);
  });
});
