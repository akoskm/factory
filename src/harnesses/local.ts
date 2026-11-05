import type { Harness, HarnessRunInput, HarnessRunResult } from "./types.js";

export const localHarness: Harness = {
  name: "local",
  async run(input: HarnessRunInput): Promise<HarnessRunResult> {
    const apiKey = input.apiKey ?? process.env.LOCAL_API_KEY ?? "not-needed";
    const baseURL = (input.baseURL ?? process.env.LOCAL_API_BASE_URL ?? "http://127.0.0.1:18434/v1").replace(/\/+$/, "");
    const model = input.model || "Qwen3.6-35B-A3B-UD-Q4_K_M";

    let transcript = "";
    let promptTokens = 0;
    let completionTokens = 0;

    try {
      const res = await fetch(`${baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: input.prompt }],
          stream: true,
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        return {
          status: "error",
          transcript: "",
          error: `API error ${res.status}: ${body.slice(0, 500)}`,
        };
      }

      const reader = res.body?.getReader();
      if (!reader) {
        return {
          status: "error",
          transcript: "",
          error: "No response body",
        };
      }

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;

          const data = trimmed.slice(6);
          if (data === "[DONE]") continue;

          try {
            const chunk = JSON.parse(data) as {
              choices?: { delta?: { content?: string }; finish_reason?: string | null }[];
              usage?: { prompt_tokens?: number; completion_tokens?: number };
            };

            for (const choice of chunk.choices ?? []) {
              if (choice.delta?.content) {
                transcript += choice.delta.content;
              }
            }

            if (chunk.usage) {
              promptTokens += chunk.usage.prompt_tokens ?? 0;
              completionTokens += chunk.usage.completion_tokens ?? 0;
            }
          } catch {
            // skip malformed chunks
          }
        }
      }

      return {
        status: "finished",
        transcript,
        usage:
          promptTokens > 0 || completionTokens > 0
            ? { inputTokens: promptTokens, outputTokens: completionTokens }
            : undefined,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        status: "error",
        transcript,
        error: message,
      };
    }
  },
};
