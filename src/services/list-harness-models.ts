import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { decryptSecret } from "../crypto/secrets.js";
import { db } from "../db/index.js";
import { secrets } from "../db/schema.js";
import { opencodeChildEnv } from "../harnesses/opencode.js";
import { isHarnessName, type HarnessName } from "../harnesses/types.js";
import { redactSecrets } from "../secrets/redact.js";

const execFileAsync = promisify(execFile);

export type Harness = HarnessName;

export function harnessKeyName(harness: string): string {
  if (harness === "claude-code") return "ANTHROPIC_API_KEY";
  if (harness === "local") return "LOCAL_API_KEY";
  if (harness === "opencode") return "OPENCODE_API_KEY";
  return "CURSOR_API_KEY";
}

/** OpenCode free models and local OpenAI-compatible endpoints work without a key. */
export function harnessRequiresApiKey(harness: string): boolean {
  return harness !== "local" && harness !== "opencode";
}

export function isHarness(value: string): value is Harness {
  return isHarnessName(value);
}

export async function resolveHarnessApiKey(
  projectId: string,
  harness: string,
): Promise<string | undefined> {
  const keyName = harnessKeyName(harness);
  const rows = await db.select().from(secrets).where(eq(secrets.projectId, projectId));
  const found = rows.find((r) => r.key === keyName);
  if (found) {
    const token = decryptSecret(found.ciphertext);
    return token.trim() ? token : undefined;
  }
  const env = process.env[keyName];
  return env?.trim() ? env : undefined;
}

export function sortModelIds(ids: string[]): string[] {
  return [...new Set(ids.filter((id) => id.trim().length > 0))].sort((a, b) =>
    a.localeCompare(b),
  );
}

export function modelSelectOptions(models: string[], current: string): string[] {
  if (!models.length) return current ? [current] : [];
  return models.includes(current) ? models : [current, ...models];
}

export function pickModelOnHarnessChange(models: string[], current: string): string {
  if (models.includes(current)) return current;
  return models[0] ?? current;
}

export async function listCursorModels(apiKey: string): Promise<string[]> {
  const { Cursor } = await import("@cursor/sdk");
  const models = await Cursor.models.list({ apiKey });
  const ids = models.map((m) => (typeof m === "object" && m && "id" in m ? String(m.id) : ""));
  return sortModelIds(ids);
}

export async function listAnthropicModels(apiKey: string): Promise<string[]> {
  const res = await fetch("https://api.anthropic.com/v1/models", {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic ${res.status}: ${text.slice(0, 200) || res.statusText}`);
  }
  const data = (await res.json()) as { data?: { id: string }[] };
  const ids = Array.isArray(data.data) ? data.data.map((m) => m.id) : [];
  return sortModelIds(ids);
}

export async function listLocalModels(apiKey: string, baseURL: string): Promise<string[]> {
  const url = baseURL.replace(/\/+$/, "");
  const res = await fetch(`${url}/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Local API ${res.status}: ${text.slice(0, 200) || res.statusText}`);
  }
  const data = (await res.json()) as { data?: { id: string }[] };
  const ids = Array.isArray(data.data) ? data.data.map((m) => m.id) : [];
  return sortModelIds(ids);
}

export function parseOpencodeModels(stdout: string): string[] {
  return sortModelIds(stdout.split(/\r?\n/).map((line) => line.trim()));
}

export async function listOpencodeModels(apiKey?: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync("opencode", ["models"], {
      env: opencodeChildEnv(apiKey, true),
      timeout: 60_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return parseOpencodeModels(stdout);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      message.includes("ENOENT") ? "opencode CLI not found" : redactSecrets(message),
    );
  }
}

export async function verifyOpencodeKey(apiKey: string): Promise<{ modelCount: number }> {
  const res = await fetch("https://opencode.ai/inference/v1/models", {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenCode ${res.status}: ${text.slice(0, 200) || res.statusText}`);
  }
  const data = (await res.json()) as { data?: { id?: string }[] };
  return { modelCount: Array.isArray(data.data) ? data.data.length : 0 };
}

export async function listHarnessModels(
  projectId: string,
  harness: Harness,
  baseURL?: string,
): Promise<{ models: string[]; error?: string }> {
  const keyName = harnessKeyName(harness);
  const apiKey = await resolveHarnessApiKey(projectId, harness);

  if (harness === "opencode") {
    return { models: await listOpencodeModels(apiKey) };
  }

  if (!apiKey) {
    return {
      models: [],
      error: `${keyName} is not set for this project (Settings or environment)`,
    };
  }

  const models =
    harness === "claude-code"
      ? await listAnthropicModels(apiKey)
      : harness === "local"
        ? await listLocalModels(apiKey, baseURL ?? "http://127.0.0.1:18434/v1")
        : await listCursorModels(apiKey);
  return { models };
}
