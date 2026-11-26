import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createOpencodeParser,
  opencodeArgs,
  opencodeChildEnv,
} from "./opencode.js";

describe("opencodeArgs", () => {
  it("includes --auto when tools are enabled (default)", () => {
    const args = opencodeArgs({ prompt: "hi", model: "opencode/a" });
    assert.ok(args.includes("--auto"));
    assert.deepEqual(args.slice(0, 4), ["run", "hi", "--model", "opencode/a"]);
  });

  it("omits --auto when tools is false", () => {
    const args = opencodeArgs({ prompt: "classify", model: "opencode/a", tools: false });
    assert.equal(args.includes("--auto"), false);
    assert.ok(args.includes("--format"));
    assert.ok(args.includes("json"));
  });
});

describe("opencodeChildEnv", () => {
  it("does not inherit secrets from process.env", () => {
    const prev = {
      DATABASE_URL: process.env.DATABASE_URL,
      GITHUB_TOKEN: process.env.GITHUB_TOKEN,
      CURSOR_API_KEY: process.env.CURSOR_API_KEY,
      FACTORY_SECRET: process.env.FACTORY_SECRET,
    };
    process.env.DATABASE_URL = "postgres://secret";
    process.env.GITHUB_TOKEN = "ghp_secret";
    process.env.CURSOR_API_KEY = "crsr_secret";
    process.env.FACTORY_SECRET = "factory-secret";
    try {
      const env = opencodeChildEnv("oc-key", true);
      assert.equal(env.OPENCODE_API_KEY, "oc-key");
      assert.equal(env.DATABASE_URL, undefined);
      assert.equal(env.GITHUB_TOKEN, undefined);
      assert.equal(env.CURSOR_API_KEY, undefined);
      assert.equal(env.FACTORY_SECRET, undefined);
      assert.ok(env.PATH);
    } finally {
      for (const [key, value] of Object.entries(prev)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("sets deny-all OPENCODE_CONFIG_CONTENT when tools is false", () => {
    const env = opencodeChildEnv(undefined, false);
    assert.ok(env.OPENCODE_CONFIG_CONTENT);
    const config = JSON.parse(env.OPENCODE_CONFIG_CONTENT!) as {
      permissions: { effect: string }[];
    };
    assert.equal(config.permissions[0]?.effect, "deny");
    assert.equal(env.OPENCODE_API_KEY, undefined);
  });
});

describe("createOpencodeParser", () => {
  it("accumulates text and tool use into a transcript", () => {
    const parser = createOpencodeParser();
    assert.equal(
      parser.feed(
        `${JSON.stringify({ type: "text", part: { text: "Hello" } })}\n` +
          `${JSON.stringify({
            type: "tool_use",
            part: { tool: "read", state: { status: "completed", input: { path: "a.ts" } } },
          })}\n`,
      ),
      true,
    );
    parser.end();
    assert.match(parser.transcript(), /Hello/);
    assert.match(parser.transcript(), /read a\.ts/);
  });
});
