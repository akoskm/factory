import { spawn } from "node:child_process";
import type { Harness, HarnessRunInput, HarnessRunResult } from "./types.js";
import { redactSecrets } from "../secrets/redact.js";

type OpencodeTokenUsage = { input?: unknown; output?: unknown };

type OpencodeEvent = {
  type?: string;
  part?: {
    text?: string;
    tool?: string;
    tokens?: OpencodeTokenUsage;
    cost?: unknown;
    state?: {
      status?: string;
      input?: Record<string, unknown>;
    };
  };
  error?: { message?: string; type?: string } | string;
};

/** Deny every tool when `tools: false` (suggestion judge, one-shot classification). */
const TOOLS_DISABLED_CONFIG = JSON.stringify({
  permissions: [{ action: "*", resource: "*", effect: "deny" }],
});

const SAFE_ENV_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TMPDIR",
  "TMP",
  "TEMP",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
  "TERM",
] as const;

export function createOpencodeParser() {
  let buffer = "";
  const textParts: string[] = [];
  const toolLog: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  let sawCost = false;
  let error: string | undefined;

  function handle(event: OpencodeEvent): boolean {
    switch (event.type) {
      case "text":
        if (typeof event.part?.text === "string" && event.part.text.length > 0) {
          textParts.push(event.part.text);
          return true;
        }
        return false;
      case "tool_use": {
        const tool = event.part?.tool?.trim();
        if (!tool) return false;
        const target = toolTarget(event.part?.state?.input);
        const status = event.part?.state?.status;
        const suffix = status && status !== "completed" ? `: ${status}` : "";
        toolLog.push(`${tool}${target ? ` ${target}` : ""}${suffix}`);
        return true;
      }
      case "step_finish": {
        const tokens = event.part?.tokens;
        if (tokens) {
          inputTokens += tokenCount(tokens.input);
          outputTokens += tokenCount(tokens.output);
        }
        if (typeof event.part?.cost === "number" && Number.isFinite(event.part.cost)) {
          costUsd += event.part.cost;
          sawCost = true;
        }
        return false;
      }
      case "error":
        error = formatError(event.error);
        return false;
      default:
        return false;
    }
  }

  function handleLine(line: string): boolean {
    try {
      const parsed = JSON.parse(line) as unknown;
      if (!parsed || typeof parsed !== "object") return false;
      return handle(parsed as OpencodeEvent);
    } catch {
      // Ignore non-JSON output; opencode may print diagnostics on stdout.
      return false;
    }
  }

  return {
    /** Feed a stdout chunk. Returns true when the visible transcript changed. */
    feed(chunk: string): boolean {
      buffer += chunk;
      let changed = false;
      for (;;) {
        const index = buffer.indexOf("\n");
        if (index < 0) break;
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line && handleLine(line)) changed = true;
      }
      return changed;
    },
    end(): boolean {
      const line = buffer.trim();
      buffer = "";
      return line ? handleLine(line) : false;
    },
    transcript(): string {
      return renderTranscript(textParts, toolLog);
    },
    usage(): HarnessRunResult["usage"] {
      if (!sawCost && inputTokens === 0 && outputTokens === 0) return undefined;
      return {
        inputTokens,
        outputTokens,
        ...(sawCost ? { costUsd } : {}),
      };
    },
    error(): string | undefined {
      return error;
    },
  };
}

export function opencodeArgs(
  input: Pick<HarnessRunInput, "prompt" | "model" | "tools">,
): string[] {
  const args = ["run", input.prompt];
  const model = input.model.trim();
  if (model) args.push("--model", model);
  args.push("--format", "json", "--archived", "--standalone");
  // `--auto` auto-approves tools; only for agent runs that allow tools.
  if (input.tools !== false) args.push("--auto");
  return args;
}

/** Minimal env for OpenCode child — no DB/GitHub/other harness secrets. */
export function opencodeChildEnv(
  apiKey?: string,
  tools = true,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of SAFE_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  if (!env.PATH) env.PATH = "/usr/local/bin:/usr/bin:/bin";
  if (!env.HOME) env.HOME = "/tmp";
  if (apiKey?.trim()) env.OPENCODE_API_KEY = apiKey.trim();
  if (tools === false) {
    env.OPENCODE_CONFIG_CONTENT = TOOLS_DISABLED_CONFIG;
  }
  return env;
}

export const opencodeHarness: Harness = {
  name: "opencode",
  async run(input: HarnessRunInput): Promise<HarnessRunResult> {
    const parser = createOpencodeParser();
    const toolsEnabled = input.tools !== false;
    const env = opencodeChildEnv(input.apiKey, toolsEnabled);

    return new Promise((resolve) => {
      const child = spawn("opencode", opencodeArgs(input), {
        cwd: input.cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stderr = "";
      let settled = false;

      const finish = (result: HarnessRunResult) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      child.stdout.on("data", (chunk) => {
        if (parser.feed(String(chunk))) {
          void input.onDelta?.(parser.transcript());
        }
      });
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
      child.on("error", (err) => {
        finish({
          status: "error",
          transcript: parser.transcript(),
          error: err.message.includes("ENOENT")
            ? "opencode CLI not found"
            : redactSecrets(err.message),
        });
      });
      child.on("close", (code) => {
        parser.end();
        const transcript = parser.transcript();
        const usage = parser.usage();
        const parseError = parser.error();

        if (parseError) {
          finish({
            status: "error",
            transcript,
            usage,
            error: redactSecrets(parseError),
          });
          return;
        }
        if (code !== 0) {
          finish({
            status: "error",
            transcript,
            usage,
            error: redactSecrets(stderr.trim() || `opencode exited ${code}`),
          });
          return;
        }
        finish({ status: "finished", transcript, usage });
      });
    });
  },
};

function tokenCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toolTarget(input: Record<string, unknown> | undefined): string {
  if (!input) return "";
  const value = input.path ?? input.command ?? input.filePath ?? input.pattern;
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, 120);
}

function formatError(error: OpencodeEvent["error"]): string {
  if (!error) return "opencode run failed";
  if (typeof error === "string") return error;
  return error.message?.trim() || error.type?.trim() || "opencode run failed";
}

function renderTranscript(parts: string[], toolLog: string[]): string {
  const text = parts.filter(Boolean).join("\n\n");
  if (!toolLog.length) return text;
  const log = ["# Tool log", ...toolLog.map((line) => `- ${line}`)].join("\n");
  return text ? `${text}\n\n${log}` : log;
}
