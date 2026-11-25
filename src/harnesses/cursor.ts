import type { Harness, HarnessRunInput, HarnessRunResult } from "./types.js";
import { collectCursorTranscript } from "./cursor-stream.js";
import { resolveCursorUsage } from "./usage.js";

export const cursorHarness: Harness = {
  name: "cursor",
  async run(input: HarnessRunInput): Promise<HarnessRunResult> {
    const apiKey = input.apiKey ?? process.env.CURSOR_API_KEY;
    if (!apiKey) {
      return {
        status: "error",
        transcript: "",
        error: "Missing CURSOR_API_KEY",
      };
    }

    try {
      const { Agent } = await import("@cursor/sdk");
      const agent = await Agent.create({
        apiKey,
        model: { id: input.model || "composer-2" },
        local: { cwd: input.cwd, settingSources: ["project"] },
      });

      try {
        const run = await agent.send(input.prompt);
        const { transcript, result } = await collectCursorTranscript(
          run as Parameters<typeof collectCursorTranscript>[0],
          input.onDelta,
        );
        const usage = await resolveCursorUsage(() => agent.getUsage(), result.usage);
        if (result.status === "error") {
          return {
            status: "error",
            transcript,
            error: "Cursor run finished with error status",
            usage,
          };
        }
        return {
          status: "finished",
          transcript,
          usage,
        };
      } finally {
        await agent[Symbol.asyncDispose]();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const retryable =
        typeof err === "object" && err && "isRetryable" in err
          ? Boolean((err as { isRetryable?: boolean }).isRetryable)
          : false;
      return {
        status: "error",
        transcript: "",
        error: `${message}${retryable ? " (retryable)" : ""}`,
      };
    }
  },
};
