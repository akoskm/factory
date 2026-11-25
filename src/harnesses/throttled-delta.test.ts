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
});
