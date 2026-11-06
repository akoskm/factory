import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const READ_MAX = 80_000;
const OUTPUT_MAX = 30_000;
const BASH_TIMEOUT_MS = 120_000;

export const LOCAL_TOOL_SCHEMAS = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a UTF-8 text file in the workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path relative to the workspace." },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Create or overwrite a UTF-8 text file in the workspace.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path relative to the workspace." },
          content: { type: "string", description: "Full new file contents." },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description: "Replace one exact occurrence of old_string in a workspace file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          old_string: { type: "string", description: "Exact text to replace. Must match once." },
          new_string: { type: "string" },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "bash",
      description: "Run a shell command in the workspace. Use for tests, git, and search.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string" },
        },
        required: ["command"],
      },
    },
  },
] as const;

export type InlineToolCall = { name: string; arguments: string };

export function parseInlineToolCalls(content: string): { text: string; calls: InlineToolCall[] } {
  const calls: InlineToolCall[] = [];
  const text = content
    .replace(/<tool_call>([\s\S]*?)<\/tool_call>/g, (block, body: string) => {
      const call = parseToolBlock(String(body).trim());
      if (!call) return block;
      calls.push(call);
      return "";
    })
    .trim();
  return { text, calls };
}

export async function runLocalTool(
  cwd: string,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  try {
    switch (name) {
      case "read_file":
        return clip(await readFile(workspacePath(cwd, requiredString(args.path, "path")), "utf8"), READ_MAX);
      case "write_file":
        return writeWorkspaceFile(
          cwd,
          requiredString(args.path, "path"),
          requiredString(args.content, "content"),
        );
      case "edit_file":
        return editWorkspaceFile(
          cwd,
          requiredString(args.path, "path"),
          requiredString(args.old_string, "old_string"),
          requiredString(args.new_string, "new_string"),
        );
      case "bash":
        return runBash(cwd, requiredString(args.command, "command"));
      default:
        return `error: unknown tool ${name}`;
    }
  } catch (err) {
    return `error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

function parseToolBlock(body: string): InlineToolCall | null {
  if (body.startsWith("{")) {
    try {
      const parsed = JSON.parse(body) as {
        name?: string;
        arguments?: unknown;
        parameters?: unknown;
      };
      if (!parsed.name) return null;
      const args = parsed.arguments ?? parsed.parameters ?? {};
      return {
        name: String(parsed.name),
        arguments: typeof args === "string" ? args : JSON.stringify(args),
      };
    } catch {
      return null;
    }
  }
  const name = body.match(/<function=([^\s>]+)>/)?.[1];
  if (!name) return null;
  const params: Record<string, string> = {};
  const re = /<parameter=([^\s>]+)>\s*([\s\S]*?)\s*<\/parameter>/g;
  for (let match = re.exec(body); match; match = re.exec(body)) {
    params[match[1]] = match[2];
  }
  return { name, arguments: JSON.stringify(params) };
}

function workspacePath(cwd: string, rel: string): string {
  const root = path.resolve(cwd);
  const target = path.resolve(root, rel);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error("path is outside the workspace");
  }
  return target;
}

async function writeWorkspaceFile(cwd: string, rel: string, content: string): Promise<string> {
  const target = workspacePath(cwd, rel);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
  return "ok";
}

async function editWorkspaceFile(
  cwd: string,
  rel: string,
  oldString: string,
  newString: string,
): Promise<string> {
  const target = workspacePath(cwd, rel);
  const text = await readFile(target, "utf8");
  const count = text.split(oldString).length - 1;
  if (count === 0) return "error: old_string not found";
  if (count > 1) return `error: old_string matched ${count} times`;
  await writeFile(target, text.replace(oldString, newString));
  return "ok";
}

function runBash(cwd: string, command: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let settled = false;
    const finish = (result: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(`error: command timed out after ${BASH_TIMEOUT_MS}ms\n${clip(out, OUTPUT_MAX)}`);
    }, BASH_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      out += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      out += String(chunk);
    });
    child.on("error", (err) => finish(`error: ${err.message}`));
    child.on("close", (code) => finish(`exit ${code ?? 1}\n${clip(out, OUTPUT_MAX)}`));
  });
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} is required`);
  return value;
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…truncated`;
}
