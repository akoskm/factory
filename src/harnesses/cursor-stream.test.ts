import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { collectCursorTranscript, type CursorStreamRun } from "./cursor-stream.js";

function fakeRun(events: { text: string }[], resultText = ""): CursorStreamRun {
  return {
    supports: (c) => c === "stream",
    stream: async function* () {
      for (const e of events) {
        yield {
          type: "assistant",
          message: { content: [{ type: "text", text: e.text }] },
        };
      }
    },
    wait: async () => ({ status: "finished", result: resultText || events.map((e) => e.text).join("") }),
  };
}

describe("collectCursorTranscript", () => {
  it("calls onDelta with growing transcript during stream", async () => {
    const deltas: string[] = [];
    const { transcript } = await collectCursorTranscript(fakeRun([{ text: "Hello" }, { text: " world" }]), (t) => {
      deltas.push(t);
    });
    assert.deepEqual(deltas, ["Hello", "Hello world"]);
    assert.equal(transcript, "Hello world");
  });

  it("falls back to wait result when stream has no text", async () => {
    const run: CursorStreamRun = {
      supports: () => false,
      stream: async function* () {},
      wait: async () => ({ status: "finished", result: "from wait" }),
    };
    const { transcript } = await collectCursorTranscript(run);
    assert.equal(transcript, "from wait");
  });
});
