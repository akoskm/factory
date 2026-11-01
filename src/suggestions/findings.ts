export type SuggestionFinding = {
  title: string;
  summary: string;
  problem: string;
  solution: string;
  agent: string | null;
  runIds: string[];
};

export type OpenSuggestion = {
  id: string;
  title: string;
  summary: string;
  problem: string;
  agent: string | null;
};

export type GroupAction = {
  type: "create" | "update";
  suggestionId: string;
  finding: SuggestionFinding;
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parseSuggestionFindings(transcript: string): SuggestionFinding[] {
  const match = transcript.match(/```artifact:suggestions\s*\n([\s\S]*?)```/i);
  if (!match) return [];
  let data: unknown;
  try {
    data = JSON.parse(match[1]);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: SuggestionFinding[] = [];
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const title = text(row.title);
    const problem = text(row.problem);
    if (!title || !problem) continue;
    const runIds = Array.isArray(row.runIds)
      ? [
          ...new Set(
            row.runIds
              .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
              .map((id) => id.trim()),
          ),
        ]
      : [];
    out.push({
      title,
      summary: text(row.summary),
      problem,
      solution: text(row.solution),
      agent: text(row.agent) || null,
      runIds,
    });
  }
  return out;
}

export function shortError(error: string | null): string {
  const line = (error ?? "")
    .split("\n")
    .map((part) => part.trim())
    .find(Boolean);
  return (line ?? "").slice(0, 160);
}

export function learnFindingsInstructions(
  runs: { id: string; agentName: string; error: string }[],
): string {
  const list = runs.length
    ? runs.map((run) => `- ${run.id} ${run.agentName}: ${run.error || "(no error text)"}`).join("\n")
    : "(none)";
  return `# Suggestion findings
When you finish, emit one fenced block named artifact:suggestions.
It is a JSON array. Each item is one problem:
{"title","summary","problem","solution","agent","runIds"}
title and problem are required. summary is one line. agent is the factory agent at fault.
runIds are runs from this list where that problem showed up. Do not invent ids.
Do not decide whether a problem is new or already known.

Recent failed runs:
${list}`;
}

export function judgePrompt(finding: SuggestionFinding, open: OpenSuggestion[]): string {
  const catalog = open
    .map((row) =>
      [
        `id: ${row.id}`,
        `title: ${row.title}`,
        row.agent ? `agent: ${row.agent}` : null,
        `summary: ${row.summary}`,
        `problem: ${row.problem}`,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
  return `You decide whether a new factory problem is the same failure mode as an existing open suggestion.
The same agent, or a similar area, is not enough.
Reply with one JSON object and nothing else: {"matchId":"<id>"} or {"matchId":null}.

Open suggestions:
${catalog || "(none)"}

New problem:
title: ${finding.title}
agent: ${finding.agent ?? ""}
summary: ${finding.summary}
problem: ${finding.problem}`;
}

export function parseJudgeMatch(text: string, allowedIds: ReadonlySet<string>): string | null {
  const match = text.match(/\{[\s\S]*?\}/);
  if (!match) return null;
  try {
    const data = JSON.parse(match[0]) as { matchId?: unknown };
    return typeof data.matchId === "string" && allowedIds.has(data.matchId) ? data.matchId : null;
  } catch {
    return null;
  }
}
