import { issueLabel, issueNumberFromUrl } from "./issue-label";
import type { WorkItem } from "./api";

export const ALL_RUNS_OPTION_ID = "__all__";

export type RunsWorkItemFilterOption = {
  id: string;
  title: string;
  url: string | null;
  sortKey: string;
  isAll?: boolean;
};

export function runsWorkItemFilterOptionLabel(option: RunsWorkItemFilterOption): string {
  if (option.isAll) return "All runs";
  if (option.url) return `${option.title} · ${issueLabel(option.url)}`;
  return option.title;
}

export function runsWorkItemFilterOptionSearchText(option: RunsWorkItemFilterOption): string {
  if (option.isAll) return "all runs";
  const parts = [option.title.toLowerCase()];
  if (option.url) {
    parts.push(issueLabel(option.url).toLowerCase());
    const number = issueNumberFromUrl(option.url);
    if (number) {
      parts.push(number, `#${number}`);
    }
  }
  return parts.join(" ");
}

export function buildRunsWorkItemFilterOptions(
  runs: { workItemId: string }[],
  workItems: WorkItem[],
): RunsWorkItemFilterOption[] {
  const workItemById = new Map(workItems.map((item) => [item.id, item]));
  const ids = [...new Set(runs.map((run) => run.workItemId))];

  const options: RunsWorkItemFilterOption[] = ids.map((id) => {
    const item = workItemById.get(id);
    if (item) {
      return {
        id,
        title: item.title,
        url: item.url || null,
        sortKey: item.title,
      };
    }
    return {
      id,
      title: `Work item ${id.slice(0, 8)}`,
      url: null,
      sortKey: id,
    };
  });

  options.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  return [
    {
      id: ALL_RUNS_OPTION_ID,
      title: "All runs",
      url: null,
      sortKey: "",
      isAll: true,
    },
    ...options,
  ];
}

export function filterRunsWorkItemOptions(
  option: RunsWorkItemFilterOption,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return runsWorkItemFilterOptionSearchText(option).includes(q);
}
