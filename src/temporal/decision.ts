import { parse as parseYaml } from "yaml";
import type { AgentDecision } from "./shared.js";

const ACTION_RE = /action:\s*(spawn|complete|fail|ask_user)/i;

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value
    .map((v) => (typeof v === "string" ? v.trim() : String(v ?? "").trim()))
    .filter(Boolean);
  return out.length > 0 ? out : undefined;
}

function decisionFromObject(raw: unknown): AgentDecision | null {
  if (!raw || typeof raw !== "object") return null;
  const root = raw as Record<string, unknown>;
  const body = (root.decision && typeof root.decision === "object"
    ? root.decision
    : root) as Record<string, unknown>;
  const actionRaw = typeof body.action === "string" ? body.action.trim().toLowerCase() : "";
  if (
    actionRaw !== "spawn" &&
    actionRaw !== "complete" &&
    actionRaw !== "fail" &&
    actionRaw !== "ask_user"
  ) {
    return null;
  }
  const agent =
    typeof body.agent === "string" && body.agent.trim()
      ? body.agent.trim().toLowerCase()
      : undefined;
  const note =
    typeof body.note === "string" && body.note.trim() ? body.note.trim() : undefined;
  const options = asStringArray(body.options);
  return {
    action: actionRaw,
    ...(agent ? { agent } : {}),
    ...(note ? { note } : {}),
    ...(options ? { options } : {}),
  };
}

/** Prefer the last decision block so earlier example YAML does not drive the pipeline. */
export function parseDecision(transcript: string): AgentDecision | null {
  const indented = [...transcript.matchAll(/decision:\s*\n(?:[ \t].+\n?)+/gi)];
  const fences = [...transcript.matchAll(/```ya?ml\s*([\s\S]*?)```/gi)];
  const candidates: string[] = [];
  for (let i = indented.length - 1; i >= 0; i--) {
    if (ACTION_RE.test(indented[i][0])) candidates.push(indented[i][0]);
  }
  for (let i = fences.length - 1; i >= 0; i--) {
    const body = fences[i][1] ?? fences[i][0];
    if (ACTION_RE.test(body)) candidates.push(body);
  }
  for (const block of candidates) {
    try {
      const parsed = decisionFromObject(parseYaml(block));
      if (parsed) return parsed;
    } catch {
      // try next candidate
    }
  }
  return null;
}
