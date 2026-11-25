export type CursorStreamEvent = {
  type: string;
  message?: { content?: Array<{ type: string; text?: string }> } | string;
};

export type CursorStreamRun = {
  supports(capability: string): boolean;
  stream(): AsyncIterable<CursorStreamEvent>;
  wait(): Promise<{ status?: string; result?: unknown; usage?: { inputTokens: number; outputTokens: number } }>;
};

/** Accumulate assistant text from a Cursor run stream; call onDelta after each assistant event. */
export async function collectCursorTranscript(
  run: CursorStreamRun,
  onDelta?: (transcript: string) => void | Promise<void>,
): Promise<{
  transcript: string;
  result: Awaited<ReturnType<CursorStreamRun["wait"]>>;
}> {
  let transcript = "";
  if (run.supports("stream")) {
    for await (const event of run.stream()) {
      if (event.type !== "assistant" || !event.message || typeof event.message === "string") continue;
      const content = event.message.content ?? [];
      for (const block of content) {
        if (block.type === "text" && typeof block.text === "string") transcript += block.text;
      }
      if (onDelta) await onDelta(transcript);
    }
  }
  const result = await run.wait();
  return { transcript: transcript || String(result.result ?? ""), result };
}
