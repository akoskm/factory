import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { singleFlight } from "./single-flight.js";

describe("singleFlight", () => {
  it("shares one in-flight promise for the same key", async () => {
    let runs = 0;
    const map = new Map<string, Promise<string>>();
    const start = () =>
      singleFlight(map, "HEAD", async () => {
        runs += 1;
        await new Promise((r) => setTimeout(r, 20));
        return "ok";
      });
    const [a, b] = await Promise.all([start(), start()]);
    assert.equal(a, "ok");
    assert.equal(b, "ok");
    assert.equal(runs, 1);
  });

  it("runs again after the previous flight settles", async () => {
    let runs = 0;
    const map = new Map<string, Promise<number>>();
    const start = () =>
      singleFlight(map, "HEAD", async () => {
        runs += 1;
        return runs;
      });
    assert.equal(await start(), 1);
    assert.equal(await start(), 2);
  });

  it("clears the slot on failure so the next call retries", async () => {
    let runs = 0;
    const map = new Map<string, Promise<string>>();
    const start = (fail: boolean) =>
      singleFlight(map, "HEAD", async () => {
        runs += 1;
        if (fail) throw new Error("boom");
        return "ok";
      });
    await assert.rejects(() => start(true), /boom/);
    assert.equal(await start(false), "ok");
    assert.equal(runs, 2);
  });
});
