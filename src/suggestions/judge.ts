import { tmpdir } from "node:os";
import { getHarness } from "../harnesses/index.js";
import type { OpenSuggestion, SuggestionFinding } from "./findings.js";
import { judgePrompt, parseJudgeMatch } from "./findings.js";

export async function judgeSuggestionMatch(input: {
  harness: string;
  model: string;
  apiKey?: string;
  finding: SuggestionFinding;
  open: OpenSuggestion[];
}): Promise<string | null> {
  const allowed = new Set(input.open.map((row) => row.id));
  if (!input.harness || !input.model || allowed.size === 0) return null;
  try {
    const result = await getHarness(input.harness).run({
      cwd: tmpdir(),
      prompt: judgePrompt(input.finding, input.open),
      model: input.model,
      apiKey: input.apiKey,
    });
    if (result.status !== "finished") {
      console.error(`suggestion judge failed: ${result.error ?? result.status}`);
      return null;
    }
    return parseJudgeMatch(result.transcript, allowed);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`suggestion judge failed: ${message}`);
    return null;
  }
}
