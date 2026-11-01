import { randomUUID } from "node:crypto";
import type { GroupAction, OpenSuggestion, SuggestionFinding } from "./findings.js";

export async function groupFindings(
  findings: SuggestionFinding[],
  open: OpenSuggestion[],
  judge: (finding: SuggestionFinding, open: OpenSuggestion[]) => Promise<string | null>,
): Promise<GroupAction[]> {
  const catalog = open.map((row) => ({ ...row }));
  const actions: GroupAction[] = [];
  for (const finding of findings) {
    let matchId: string | null = null;
    if (catalog.length) {
      const judged = await judge(finding, catalog);
      if (judged && catalog.some((row) => row.id === judged)) matchId = judged;
    }
    if (matchId) {
      const row = catalog.find((item) => item.id === matchId);
      if (row) {
        row.title = finding.title;
        row.summary = finding.summary;
        row.problem = finding.problem;
        row.agent = finding.agent;
      }
      actions.push({ type: "update", suggestionId: matchId, finding });
      continue;
    }
    const suggestionId = randomUUID();
    catalog.push({
      id: suggestionId,
      title: finding.title,
      summary: finding.summary,
      problem: finding.problem,
      agent: finding.agent,
    });
    actions.push({ type: "create", suggestionId, finding });
  }
  return actions;
}
