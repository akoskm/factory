import { spawn } from "node:child_process";
import type { Harness, HarnessRunInput, HarnessRunResult } from "./types.js";
import { parseClaudeResult } from "./usage.js";

export const claudeCodeHarness: Harness = {
  name: "claude-code",
  async run(input: HarnessRunInput): Promise<HarnessRunResult> {
    const apiKey = input.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return { status: "error", transcript: "", error: "Missing ANTHROPIC_API_KEY" };
    }

    return new Promise((resolve) => {
      const child = spawn(
        "claude",
        ["-p", input.prompt, "--output-format", "json", ...(input.model ? ["--model", input.model] : [])],
        {
          cwd: input.cwd,
          env: { ...process.env, ANTHROPIC_API_KEY: apiKey },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => {
        stdout += String(d);
      });
      child.stderr.on("data", (d) => {
        stderr += String(d);
      });
      child.on("error", (err) => {
        resolve({
          status: "error",
          transcript: "",
          error: err.message.includes("ENOENT")
            ? "claude CLI not found"
            : err.message,
        });
      });
      child.on("close", (code) => {
        const parsed = parseClaudeResult(stdout);
        if (code !== 0) {
          resolve({
            status: "error",
            transcript: parsed.transcript,
            usage: parsed.usage,
            error: stderr || `claude exited ${code}`,
          });
          return;
        }
        resolve({ status: "finished", transcript: parsed.transcript, usage: parsed.usage });
      });
    });
  },
};
