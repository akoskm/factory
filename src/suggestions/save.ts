import { and, desc, eq, inArray, isNotNull, or } from "drizzle-orm";
import { db } from "../db/index.js";
import { runs, suggestionRuns, suggestions } from "../db/schema.js";
import { groupFindings } from "./group.js";
import { judgeSuggestionMatch } from "./judge.js";
import {
  parseSuggestionFindings,
  shortError,
  type OpenSuggestion,
  type SuggestionFinding,
} from "./findings.js";

const OPEN_LIMIT = 40;
const FAILED_RUN_LIMIT = 40;

export async function recentFailedRuns(projectId: string): Promise<
  { id: string; agentName: string; error: string }[]
> {
  const rows = await db
    .select({ id: runs.id, agentName: runs.agentName, error: runs.error })
    .from(runs)
    .where(
      and(eq(runs.projectId, projectId), or(eq(runs.status, "error"), eq(runs.status, "failed"))),
    )
    .orderBy(desc(runs.startedAt))
    .limit(FAILED_RUN_LIMIT);
  return rows.map((row) => ({
    id: row.id,
    agentName: row.agentName,
    error: shortError(row.error),
  }));
}

async function allowedRunIds(projectId: string, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await db
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.projectId, projectId), inArray(runs.id, ids)));
  return new Set(rows.map((row) => row.id));
}

export async function saveLearnSuggestions(input: {
  projectId: string;
  workItemId: string;
  runId: string;
  externalId: string;
  transcript: string;
  prUrl: string | null;
  recordLegacy: boolean;
  harness: string;
  model: string;
  apiKey?: string;
  baseURL?: string;
  judge?: (finding: SuggestionFinding, open: OpenSuggestion[]) => Promise<string | null>;
}): Promise<void> {
  const findings = parseSuggestionFindings(input.transcript);
  if (!findings.length) {
    if (!input.recordLegacy) return;
    await db.insert(suggestions).values({
      projectId: input.projectId,
      workItemId: input.workItemId,
      runId: input.runId,
      title: `Learn from #${input.externalId}`,
      body: input.transcript,
      prUrl: input.prUrl,
    });
    return;
  }

  const openRows = await db
    .select()
    .from(suggestions)
    .where(
      and(
        eq(suggestions.projectId, input.projectId),
        eq(suggestions.status, "open"),
        isNotNull(suggestions.problem),
      ),
    )
    .orderBy(desc(suggestions.updatedAt))
    .limit(OPEN_LIMIT);
  const open: OpenSuggestion[] = openRows.map((row) => ({
    id: row.id,
    title: row.title,
    summary: row.summary ?? "",
    problem: row.problem ?? "",
    agent: row.targetAgent,
  }));
  const judge =
    input.judge ??
    ((finding, catalog) =>
      judgeSuggestionMatch({
        harness: input.harness,
        model: input.model,
        apiKey: input.apiKey,
        baseURL: input.baseURL,
        finding,
        open: catalog,
      }));
  const actions = await groupFindings(findings, open, judge);
  const allowed = await allowedRunIds(
    input.projectId,
    [...new Set(findings.flatMap((finding) => finding.runIds))],
  );

  await db.transaction(async (tx) => {
    for (const action of actions) {
      const runIds = action.finding.runIds.filter((id) => allowed.has(id));
      const fields = {
        title: action.finding.title,
        summary: action.finding.summary,
        problem: action.finding.problem,
        solution: action.finding.solution,
        body: action.finding.problem,
        targetAgent: action.finding.agent,
        workItemId: input.workItemId,
        runId: input.runId,
        updatedAt: new Date(),
      };
      if (action.type === "create") {
        await tx.insert(suggestions).values({
          id: action.suggestionId,
          projectId: input.projectId,
          prUrl: input.prUrl,
          ...fields,
        });
      } else {
        await tx
          .update(suggestions)
          .set({
            ...fields,
            ...(input.prUrl ? { prUrl: input.prUrl } : {}),
          })
          .where(eq(suggestions.id, action.suggestionId));
      }
      if (runIds.length) {
        await tx
          .insert(suggestionRuns)
          .values(runIds.map((runId) => ({ suggestionId: action.suggestionId, runId })))
          .onConflictDoNothing();
      }
    }
  });
}
