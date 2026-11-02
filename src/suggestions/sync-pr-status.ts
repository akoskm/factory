import { and, eq } from "drizzle-orm";
import { Octokit } from "@octokit/rest";
import { db } from "../db/index.js";
import { sources, suggestions } from "../db/schema.js";
import { resolveGithubToken } from "../config/resolve.js";
import {
  parsePullRequestUrl,
  pickGithubSourceId,
  planSuggestionStatusUpdates,
  type SuggestionStatusRow,
} from "./pr-status.js";

const PULL_TIMEOUT_MS = 5_000;

async function tokenForPulls(projectId: string, rows: SuggestionStatusRow[]): Promise<string | undefined> {
  const pulls = rows.flatMap((row) => {
    if (row.status !== "open" || !row.prUrl) return [];
    const pull = parsePullRequestUrl(row.prUrl);
    return pull ? [pull] : [];
  });
  const projectSources = await db
    .select()
    .from(sources)
    .where(and(eq(sources.projectId, projectId), eq(sources.kind, "github"), eq(sources.enabled, true)));
  const sourceId = pickGithubSourceId(
    pulls,
    projectSources.map((source) => ({
      id: source.id,
      owner: source.config.owner,
      repo: source.config.repo,
    })),
  );
  if (sourceId) {
    const token = await resolveGithubToken(sourceId);
    if (token) return token;
  }
  return resolveGithubToken();
}

export async function syncOpenSuggestionPulls<T extends SuggestionStatusRow & { updatedAt: Date }>(
  projectId: string,
  rows: T[],
): Promise<T[]> {
  if (!rows.some((row) => row.status === "open" && row.prUrl)) return rows;
  try {
    const token = await tokenForPulls(projectId, rows);
    if (!token) return rows;
    const octokit = new Octokit({ auth: token });
    const updates = await planSuggestionStatusUpdates(rows, async (pr) => {
      const { data } = await octokit.rest.pulls.get({
        owner: pr.owner,
        repo: pr.repo,
        pull_number: pr.pullNumber,
        request: { signal: AbortSignal.timeout(PULL_TIMEOUT_MS) },
      });
      return { state: data.state, merged_at: data.merged_at };
    });
    if (!updates.length) return rows;
    const now = new Date();
    await db.transaction(async (tx) => {
      for (const update of updates) {
        await tx
          .update(suggestions)
          .set({ status: update.status, updatedAt: now })
          .where(eq(suggestions.id, update.id));
      }
    });
    const next = new Map(updates.map((update) => [update.id, update.status]));
    return rows.map((row) =>
      next.has(row.id) ? { ...row, status: next.get(row.id)!, updatedAt: now } : row,
    );
  } catch {
    return rows;
  }
}
