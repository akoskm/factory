import type { AgentDecision } from "./shared.js";

const ACTION_RE = /action:\s*(spawn|complete|fail|ask_user)/i;

/** Prefer the last decision block so earlier example YAML does not drive the pipeline. */
export function parseDecision(transcript: string): AgentDecision | null {
  const indented = [...transcript.matchAll(/decision:\s*\n(?:[ \t].+\n?)+/gi)];
  const fences = [...transcript.matchAll(/```ya?ml\s*([\s\S]*?)```/gi)];
  let block: string | null = null;
  for (let i = indented.length - 1; i >= 0; i--) {
    if (ACTION_RE.test(indented[i][0])) {
      block = indented[i][0];
      break;
    }
  }
  if (!block) {
    for (let i = fences.length - 1; i >= 0; i--) {
      const body = fences[i][1] ?? fences[i][0];
      if (ACTION_RE.test(body)) {
        block = body;
        break;
      }
    }
  }
  if (!block) return null;
  const action = block.match(ACTION_RE)?.[1]?.toLowerCase() as AgentDecision["action"] | undefined;
  const agent = block.match(/agent:\s*([a-z0-9_-]+)/i)?.[1]?.toLowerCase();
  const note = block.match(/note:\s*(.+)/i)?.[1]?.trim();
  if (!action) return null;
  return { action, agent, note };
}
