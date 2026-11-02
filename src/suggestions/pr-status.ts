export type PullRef = { owner: string; repo: string; pullNumber: number };

export type PullSnapshot = { state: string; merged_at: string | null };

export type SuggestionStatusRow = { id: string; status: string; prUrl: string | null };

const PULL_URL = /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/;

export function parsePullRequestUrl(url: string): PullRef | null {
  const match = PULL_URL.exec(url);
  if (!match) return null;
  return { owner: match[1], repo: match[2], pullNumber: Number(match[3]) };
}

export function pickGithubSourceId(
  pulls: { owner: string; repo: string }[],
  sources: { id: string; owner: string; repo: string }[],
): string | null {
  const match = sources.find((source) =>
    pulls.some((pull) => pull.owner === source.owner && pull.repo === source.repo),
  );
  return (match ?? sources[0])?.id ?? null;
}

export function suggestionStatusForPull(pull: PullSnapshot): "open" | "merged" | "closed" {
  if (pull.merged_at) return "merged";
  if (pull.state === "closed") return "closed";
  return "open";
}

export async function planSuggestionStatusUpdates(
  rows: SuggestionStatusRow[],
  lookup: (pr: PullRef) => Promise<PullSnapshot>,
): Promise<{ id: string; status: "merged" | "closed" }[]> {
  const groups = new Map<string, { pr: PullRef; ids: string[] }>();
  for (const row of rows) {
    if (row.status !== "open" || !row.prUrl) continue;
    const pr = parsePullRequestUrl(row.prUrl);
    if (!pr) continue;
    const key = `${pr.owner}/${pr.repo}#${pr.pullNumber}`;
    const group = groups.get(key) ?? { pr, ids: [] };
    group.ids.push(row.id);
    groups.set(key, group);
  }

  const statuses = new Map<string, "merged" | "closed">();
  await Promise.all(
    [...groups.values()].map(async (group) => {
      try {
        const status = suggestionStatusForPull(await lookup(group.pr));
        if (status === "open") return;
        for (const id of group.ids) statuses.set(id, status);
      } catch {
        // keep the stored badge when this pull cannot be read
      }
    }),
  );

  return rows.flatMap((row) => {
    const status = statuses.get(row.id);
    return status ? [{ id: row.id, status }] : [];
  });
}
