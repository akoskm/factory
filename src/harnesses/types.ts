export interface HarnessRunInput {
  cwd: string;
  prompt: string;
  model: string;
  apiKey?: string;
  baseURL?: string;
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
  name: "cursor" | "claude-code" | "local";
  run(input: HarnessRunInput): Promise<HarnessRunResult>;
}
