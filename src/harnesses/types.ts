export const HARNESS_NAMES = ["cursor", "claude-code", "local"] as const;

export type HarnessName = (typeof HARNESS_NAMES)[number];

export function isHarnessName(value: string): value is HarnessName {
  return (HARNESS_NAMES as readonly string[]).includes(value);
}

export function parseHarnessName(value: unknown): HarnessName {
  const name = typeof value === "string" ? value.trim() : "";
  return isHarnessName(name) ? name : "cursor";
}

export interface HarnessRunInput {
  cwd: string;
  prompt: string;
  model: string;
  apiKey?: string;
  baseURL?: string;
  /** When false, one completion and no workspace tools. Defaults to true. */
  tools?: boolean;
}

export interface HarnessRunResult {
  status: "finished" | "error";
  transcript: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    costUsd?: number;
  };
  error?: string;
}

export interface Harness {
  name: HarnessName;
  run(input: HarnessRunInput): Promise<HarnessRunResult>;
}
