import type { Harness, HarnessRunInput, HarnessRunResult } from "./types.js";
import { LOCAL_TOOL_SCHEMAS, parseInlineToolCalls, runLocalTool } from "./local-tools.js";

const DEFAULT_BASE_URL = "http://127.0.0.1:18434/v1";
const DEFAULT_MODEL = "Qwen3.6-35B-A3B-UD-Q4_K_M";
const MAX_TOOL_ROUNDS = 24;

type ToolCall = { id: string; name: string; arguments: string };

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
};

type Completion = {
  content: string;
  toolCalls: ToolCall[];
  usage?: { inputTokens: number; outputTokens: number };
};

export const localHarness: Harness = {
  name: "local",
  async run(input: HarnessRunInput): Promise<HarnessRunResult> {
    const toolsEnabled = input.tools !== false;
    const apiKey = input.apiKey ?? process.env.LOCAL_API_KEY ?? "not-needed";
    const baseURL = (input.baseURL ?? process.env.LOCAL_API_BASE_URL ?? DEFAULT_BASE_URL).replace(
      /\/+$/,
      "",
    );
    const model = input.model || DEFAULT_MODEL;
    const messages: ChatMessage[] = [];
    if (toolsEnabled) {
      messages.push({ role: "system", content: systemPrompt(input.cwd) });
    }
    messages.push({ role: "user", content: input.prompt });

    let promptTokens = 0;
    let completionTokens = 0;
    const assistantParts: string[] = [];
    const toolLog: string[] = [];

    try {
      const rounds = toolsEnabled ? MAX_TOOL_ROUNDS : 1;
      for (let round = 0; round < rounds; round++) {
        const completion = await complete({ baseURL, apiKey, model, messages, tools: toolsEnabled });
        if (completion.usage) {
          promptTokens += completion.usage.inputTokens;
          completionTokens += completion.usage.outputTokens;
        }

        const inline = toolsEnabled
          ? parseInlineToolCalls(completion.content)
          : { text: completion.content, calls: [] as { name: string; arguments: string }[] };
        const calls = completion.toolCalls.length
          ? completion.toolCalls
          : inline.calls.map((call, index) => ({
              id: `inline_${round}_${index}`,
              name: call.name,
              arguments: call.arguments,
            }));
        const visible = calls.length && !completion.toolCalls.length ? inline.text : completion.content;
        if (visible.trim()) assistantParts.push(visible.trim());

        if (!toolsEnabled || calls.length === 0) {
          return finished(assistantParts, toolLog, promptTokens, completionTokens);
        }

        const results = await Promise.all(calls.map((call) => executeCall(input.cwd, call)));
        for (const result of results) toolLog.push(result.log);

        if (completion.toolCalls.length) {
          messages.push({
            role: "assistant",
            content: completion.content || null,
            tool_calls: calls.map((call) => ({
              id: call.id,
              type: "function" as const,
              function: { name: call.name, arguments: call.arguments },
            })),
          });
          for (const result of results) {
            messages.push({ role: "tool", tool_call_id: result.id, content: result.output });
          }
        } else {
          messages.push({ role: "assistant", content: completion.content });
          messages.push({
            role: "user",
            content: results.map((result) => `Tool ${result.name} result:\n${result.output}`).join("\n\n"),
          });
        }
      }

      return {
        status: "error",
        transcript: renderTranscript(assistantParts, toolLog),
        error: `stopped after ${MAX_TOOL_ROUNDS} tool rounds`,
        usage: usageOrUndefined(promptTokens, completionTokens),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        status: "error",
        transcript: renderTranscript(assistantParts, toolLog),
        error: message,
      };
    }
  },
};

function systemPrompt(cwd: string): string {
  return [
    "You are a coding agent working inside a git checkout.",
    `Workspace: ${cwd}`,
    "Use the tools to inspect the repo, edit files, and run commands. Paths are relative to the workspace.",
    "Do not claim you changed a file unless a tool call did it.",
    "When the task is finished, reply with the final message the user asked for and do not call any tools.",
  ].join("\n");
}

async function executeCall(
  cwd: string,
  call: ToolCall,
): Promise<{ id: string; name: string; output: string; log: string }> {
  let output: string;
  try {
    const parsed = call.arguments ? (JSON.parse(call.arguments) as unknown) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      output = "error: arguments must be an object";
    } else {
      output = await runLocalTool(cwd, call.name, parsed as Record<string, unknown>);
    }
  } catch {
    output = "error: invalid JSON arguments";
  }
  return { id: call.id, name: call.name, output, log: `${call.name}${callTarget(call)}: ${toolStatus(output)}` };
}

function toolStatus(output: string): string {
  const first = output.split("\n")[0] ?? "ok";
  if (output.startsWith("error:") || output.startsWith("exit ")) return first.slice(0, 160);
  return "ok";
}

function callTarget(call: ToolCall): string {
  try {
    const args = JSON.parse(call.arguments) as { path?: string; command?: string };
    const target = args.path || args.command?.slice(0, 80);
    return target ? ` ${target}` : "";
  } catch {
    return "";
  }
}

async function complete(input: {
  baseURL: string;
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  tools: boolean;
}): Promise<Completion> {
  const res = await fetch(`${input.baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({
      model: input.model,
      messages: input.messages,
      stream: false,
      ...(input.tools ? { tools: LOCAL_TOOL_SCHEMAS } : {}),
    }),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`API error ${res.status}: ${raw.slice(0, 500)}`);
  }
  const trimmed = raw.trimStart();
  if (trimmed.startsWith("{")) return parseJsonCompletion(trimmed);
  return parseSseCompletion(raw);
}

function parseJsonCompletion(raw: string): Completion {
  const data = JSON.parse(raw) as {
    choices?: { message?: { content?: string | null; tool_calls?: RawToolCall[] } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const message = data.choices?.[0]?.message;
  return {
    content: message?.content ?? "",
    toolCalls: toolCallsFrom(message?.tool_calls),
    usage: usageFrom(data.usage),
  };
}

function parseSseCompletion(raw: string): Completion {
  let content = "";
  const tools = new Map<number, ToolCall>();
  let promptTokens = 0;
  let completionTokens = 0;
  let sawUsage = false;

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    let chunk: {
      choices?: {
        delta?: { content?: string | null; tool_calls?: RawToolCall[] };
        message?: { content?: string | null; tool_calls?: RawToolCall[] };
      }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    try {
      chunk = JSON.parse(data) as typeof chunk;
    } catch {
      continue;
    }
    const choice = chunk.choices?.[0];
    const delta = choice?.delta ?? choice?.message;
    if (typeof delta?.content === "string") content += delta.content;
    for (const call of delta?.tool_calls ?? []) {
      const index = call.index ?? 0;
      const prev = tools.get(index) ?? { id: call.id || `call_${index}`, name: "", arguments: "" };
      if (call.id) prev.id = call.id;
      if (call.function?.name) prev.name += call.function.name;
      if (typeof call.function?.arguments === "string") prev.arguments += call.function.arguments;
      tools.set(index, prev);
    }
    if (chunk.usage) {
      promptTokens = chunk.usage.prompt_tokens ?? 0;
      completionTokens = chunk.usage.completion_tokens ?? 0;
      sawUsage = true;
    }
  }

  return {
    content,
    toolCalls: [...tools.values()].filter((call) => call.name),
    usage: sawUsage ? { inputTokens: promptTokens, outputTokens: completionTokens } : undefined,
  };
}

type RawToolCall = {
  index?: number;
  id?: string;
  function?: { name?: string; arguments?: unknown };
};

function toolCallsFrom(calls: RawToolCall[] | undefined): ToolCall[] {
  return (calls ?? []).flatMap((call, index) => {
    const name = call.function?.name?.trim() ?? "";
    if (!name) return [];
    const args = call.function?.arguments;
    return [
      {
        id: call.id || `call_${index}`,
        name,
        arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}),
      },
    ];
  });
}

function usageFrom(
  usage: { prompt_tokens?: number; completion_tokens?: number } | undefined,
): Completion["usage"] {
  if (!usage) return undefined;
  return {
    inputTokens: usage.prompt_tokens ?? 0,
    outputTokens: usage.completion_tokens ?? 0,
  };
}

function finished(
  assistantParts: string[],
  toolLog: string[],
  promptTokens: number,
  completionTokens: number,
): HarnessRunResult {
  return {
    status: "finished",
    transcript: renderTranscript(assistantParts, toolLog),
    usage: usageOrUndefined(promptTokens, completionTokens),
  };
}

function renderTranscript(parts: string[], toolLog: string[]): string {
  const text = parts.filter(Boolean).join("\n\n");
  if (!toolLog.length) return text;
  const log = ["# Tool log", ...toolLog.map((line) => `- ${line}`)].join("\n");
  return text ? `${text}\n\n${log}` : log;
}

function usageOrUndefined(inputTokens: number, outputTokens: number): HarnessRunResult["usage"] {
  if (inputTokens <= 0 && outputTokens <= 0) return undefined;
  return { inputTokens, outputTokens };
}
