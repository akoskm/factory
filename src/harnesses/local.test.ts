import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, afterEach } from "node:test";
import { localHarness } from "./local.js";

describe("localHarness", () => {
  const origBase = process.env.LOCAL_API_BASE_URL;
  const origKey = process.env.LOCAL_API_KEY;
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    process.env.LOCAL_API_BASE_URL = origBase;
    process.env.LOCAL_API_KEY = origKey;
    globalThis.fetch = originalFetch;
  });

  it("returns transcript from streaming response", async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n',
      'data: {"choices":[{"delta":{"content":" world"}}]}\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n',
      'data: [DONE]\n',
    ];
    globalThis.fetch = async () =>
      new Response(
        new ReadableStream({
          async start(controller) {
            for (const chunk of chunks) {
              controller.enqueue(new TextEncoder().encode(chunk));
            }
            controller.close();
          },
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      );

    process.env.LOCAL_API_BASE_URL = "http://localhost:1234/v1";
    process.env.LOCAL_API_KEY = "test-key";

    const result = await localHarness.run({
      cwd: "/tmp",
      prompt: "Say hi",
      model: "qwen-test",
    });

    assert.equal(result.status, "finished");
    assert.equal(result.transcript, "Hello world");
  });

  it("returns error on non-200 response", async () => {
    globalThis.fetch = async () =>
      new Response('{"error":"model not found"}', { status: 404 });

    process.env.LOCAL_API_BASE_URL = "http://localhost:1234/v1";
    process.env.LOCAL_API_KEY = "test-key";

    const result = await localHarness.run({
      cwd: "/tmp",
      prompt: "test",
      model: "qwen-test",
    });

    assert.equal(result.status, "error");
    assert.ok(result.error?.includes("404"));
  });

  it("collects usage tokens from stream", async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"ok"}}],"usage":{"prompt_tokens":10,"completion_tokens":5}}\n',
      'data: [DONE]\n',
    ];
    globalThis.fetch = async () =>
      new Response(
        new ReadableStream({
          async start(controller) {
            for (const chunk of chunks) {
              controller.enqueue(new TextEncoder().encode(chunk));
            }
            controller.close();
          },
        }),
        { status: 200 },
      );

    process.env.LOCAL_API_BASE_URL = "http://localhost:1234/v1";
    process.env.LOCAL_API_KEY = "test-key";

    const result = await localHarness.run({
      cwd: "/tmp",
      prompt: "test",
      model: "qwen-test",
    });

    assert.equal(result.status, "finished");
    assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 5 });
  });

  it("uses fallback apiKey from env when not provided", async () => {
    let receivedAuth = "";
    globalThis.fetch = async (url: unknown, init: unknown) => {
      const opts = init as { headers: Record<string, string> };
      receivedAuth = opts.headers["Authorization"] ?? "";
      return new Response(
        new ReadableStream({
          async start(controller) {
            controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{}}]}\ndata: [DONE]\n'));
            controller.close();
          },
        }),
        { status: 200 },
      );
    };

    process.env.LOCAL_API_BASE_URL = "http://localhost:1234/v1";
    process.env.LOCAL_API_KEY = "env-fallback-key";

    await localHarness.run({ cwd: "/tmp", prompt: "test", model: "qwen-test" });

    assert.equal(receivedAuth, "Bearer env-fallback-key");
  });

  it("strips trailing slashes from baseURL", async () => {
    let calledUrl = "";
    globalThis.fetch = async (url: unknown) => {
      calledUrl = String(url);
      return new Response(
        new ReadableStream({
          async start(controller) {
            controller.enqueue(new TextEncoder().encode('data: [DONE]\n'));
            controller.close();
          },
        }),
        { status: 200 },
      );
    };

    process.env.LOCAL_API_BASE_URL = "http://localhost:1234/v1/";
    process.env.LOCAL_API_KEY = "k";

    await localHarness.run({ cwd: "/tmp", prompt: "test", model: "qwen-test" });

    assert.ok(calledUrl.endsWith("/chat/completions"));
    assert.ok(!calledUrl.includes("v1//"));
  });

  it("keeps a final SSE event that has no trailing newline", async () => {
    globalThis.fetch = async () =>
      new Response('data: {"choices":[{"delta":{"content":"tail"}}]}', { status: 200 });

    const result = await localHarness.run({
      cwd: "/tmp",
      prompt: "x",
      model: "qwen-test",
      tools: false,
    });

    assert.equal(result.status, "finished");
    assert.equal(result.transcript, "tail");
  });

  it("uses the last usage object in one response", async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"ok"}}],"usage":{"prompt_tokens":10,"completion_tokens":5}}\n',
      'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":10,"completion_tokens":5}}\n',
      "data: [DONE]\n",
    ];
    globalThis.fetch = async () =>
      new Response(
        new ReadableStream({
          async start(controller) {
            for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
            controller.close();
          },
        }),
        { status: 200 },
      );

    const result = await localHarness.run({
      cwd: "/tmp",
      prompt: "test",
      model: "qwen-test",
      tools: false,
    });

    assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 5 });
  });

  it("writes a file from a tool call and returns the final assistant text", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "local-harness-"));
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      if (calls === 1) {
        return Response.json({
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                role: "assistant",
                content: "",
                tool_calls: [
                  {
                    id: "c1",
                    type: "function",
                    function: {
                      name: "write_file",
                      arguments: JSON.stringify({ path: "notes.txt", content: "hello" }),
                    },
                  },
                ],
              },
            },
          ],
          usage: { prompt_tokens: 2, completion_tokens: 3 },
        });
      }
      return Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: { role: "assistant", content: "decision:\n  action: complete\n" },
          },
        ],
        usage: { prompt_tokens: 4, completion_tokens: 5 },
      });
    };

    const result = await localHarness.run({ cwd, prompt: "write notes", model: "qwen" });

    assert.equal(result.status, "finished");
    assert.match(result.transcript, /decision:\n {2}action: complete/);
    assert.equal(await readFile(path.join(cwd, "notes.txt"), "utf8"), "hello");
    assert.deepEqual(result.usage, { inputTokens: 6, outputTokens: 8 });
  });

  it("executes a Qwen tool call embedded in the assistant text", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "local-harness-"));
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      if (calls === 1) {
        const payload = {
          choices: [
            {
              delta: {
                content:
                  '<tool_call>{"name":"write_file","arguments":{"path":"a.txt","content":"z"}}</tool_call>',
              },
            },
          ],
        };
        return new Response(`data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n`, { status: 200 });
      }
      return Response.json({
        choices: [{ message: { role: "assistant", content: "wrote it" } }],
      });
    };

    const result = await localHarness.run({ cwd, prompt: "write a", model: "qwen" });

    assert.equal(result.status, "finished");
    assert.match(result.transcript, /wrote it/);
    assert.equal(await readFile(path.join(cwd, "a.txt"), "utf8"), "z");
  });

  it("does not send tools or run them when tools are disabled", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "local-harness-"));
    let body: { tools?: unknown; messages: { role: string }[] } | undefined;
    globalThis.fetch = async (_url, init) => {
      body = JSON.parse(String((init as RequestInit).body)) as typeof body;
      return Response.json({
        choices: [
          {
            message: {
              role: "assistant",
              content:
                '<tool_call>{"name":"write_file","arguments":{"path":"nope.txt","content":"x"}}</tool_call>',
            },
          },
        ],
      });
    };

    const result = await localHarness.run({
      cwd,
      prompt: "judge this",
      model: "qwen",
      tools: false,
    });

    assert.equal(body?.tools, undefined);
    assert.equal(body?.messages.length, 1);
    assert.equal(body?.messages[0]?.role, "user");
    assert.match(result.transcript, /tool_call/);
    await assert.rejects(readFile(path.join(cwd, "nope.txt"), "utf8"));
  });
});
