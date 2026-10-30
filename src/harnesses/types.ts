export interface HarnessRunInput {
  cwd: string;
  prompt: string;
  model: string;
  apiKey?: string;
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
  name: "cursor" | "claude-code";
  run(input: HarnessRunInput): Promise<HarnessRunResult>;
}
