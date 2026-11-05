import assert from "node:assert/strict";
import { describe, it, afterEach } from "node:test";
import { localHarness } from "./local.js";

describe("localHarness", () => {
  const origBase = process.env.LOCAL_API_BASE_URL;
  const origKey = process.env.LOCAL_API_KEY;

  afterEach(() => {
    process.env.LOCAL_API_BASE_URL = origBase;
    process.env.LOCAL_API_KEY = origKey;
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
});
