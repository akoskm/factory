import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { parseInlineToolCalls, runLocalTool } from "./local-tools.js";

describe("runLocalTool", () => {
  it("writes and reads a file inside the workspace", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "local-tools-"));
    const wrote = await runLocalTool(cwd, "write_file", {
      path: "src/hello.txt",
      content: "hello",
    });
    assert.match(wrote, /^ok/);
    assert.equal(await readFile(path.join(cwd, "src/hello.txt"), "utf8"), "hello");
    const read = await runLocalTool(cwd, "read_file", { path: "src/hello.txt" });
    assert.equal(read, "hello");
  });

  it("replaces one match and reports missing or repeated text", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "local-tools-"));
    await writeFile(path.join(cwd, "a.txt"), "alpha beta alpha");
    const missing = await runLocalTool(cwd, "edit_file", {
      path: "a.txt",
      old_string: "nope",
      new_string: "x",
    });
    assert.match(missing, /not found/);
    const repeated = await runLocalTool(cwd, "edit_file", {
      path: "a.txt",
      old_string: "alpha",
      new_string: "z",
    });
    assert.match(repeated, /2 times/);
    const once = await runLocalTool(cwd, "edit_file", {
      path: "a.txt",
      old_string: "beta",
      new_string: "gamma",
    });
    assert.match(once, /^ok/);
    assert.equal(await readFile(path.join(cwd, "a.txt"), "utf8"), "alpha gamma alpha");
  });

  it("rejects paths outside the workspace", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "local-tools-"));
    const result = await runLocalTool(cwd, "read_file", { path: "../secret.txt" });
    assert.match(result, /outside the workspace/);
  });

  it("runs a command in the workspace", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "local-tools-"));
    const result = await runLocalTool(cwd, "bash", { command: "printf hi" });
    assert.match(result, /exit 0/);
    assert.match(result, /hi/);
  });
});

describe("parseInlineToolCalls", () => {
  it("pulls a JSON tool call out of the assistant text", () => {
    const parsed = parseInlineToolCalls(
      'working\n<tool_call>{"name":"write_file","arguments":{"path":"a.txt","content":"z"}}</tool_call>\n',
    );
    assert.equal(parsed.text, "working");
    assert.equal(parsed.calls.length, 1);
    assert.equal(parsed.calls[0]?.name, "write_file");
    assert.equal(parsed.calls[0]?.arguments, JSON.stringify({ path: "a.txt", content: "z" }));
  });

  it("pulls Qwen parameter tags out of the assistant text", () => {
    const parsed = parseInlineToolCalls(
      "<tool_call><function=write_file><parameter=path>a.txt</parameter><parameter=content>z</parameter></function></tool_call>",
    );
    assert.equal(parsed.text, "");
    assert.equal(parsed.calls[0]?.name, "write_file");
    assert.deepEqual(JSON.parse(parsed.calls[0]?.arguments ?? "{}"), { path: "a.txt", content: "z" });
  });
});
