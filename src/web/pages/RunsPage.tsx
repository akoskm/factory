import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { cn } from "cn";
import { formatUsd } from "@/format-usd";
import { api, type WorkItem } from "../api";
import { issueLabel } from "../issue-label";
import {
  buildRunsWorkItemFilterOptions,
  filterRunsWorkItemOptions,
  runsWorkItemFilterOptionLabel,
  type RunsWorkItemFilterOption,
} from "../runs-work-item-filter-options";
import { useProjectId } from "../use-project-id";
import { PageHeader } from "@/components/page-header";
import { PreBlock } from "@/components/pre-block";
import { LiveSurface, StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";

type Run = {
  id: string;
  workItemId: string;
  agentName: string;
  harness: string;
  model: string;
  status: string;
  costUsd: string | null;
  startedAt: string;
  finishedAt: string | null;
  transcript: string;
  error: string | null;
  decision: { action?: string; agent?: string; note?: string } | null;
};

export function RunsPage() {
  const projectId = useProjectId();
  const [runs, setRuns] = useState<Run[]>([]);
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [selectedWorkItemId, setSelectedWorkItemId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedWorkItemId(null);
    void Promise.all([
      api<Run[]>(`/api/projects/${projectId}/runs`),
      api<WorkItem[]>(`/api/projects/${projectId}/work-items`),
    ]).then(([rows, items]) => {
      setRuns(rows);
      setWorkItems(items);
      if (rows[0]) setOpenId(rows[0].id);
      else setOpenId(null);
    });
  }, [projectId]);

  const filterOptions = useMemo(
    () => buildRunsWorkItemFilterOptions(runs, workItems),
    [runs, workItems],
  );

  const selectedFilterOption = useMemo((): RunsWorkItemFilterOption | null => {
    if (selectedWorkItemId === null) {
      return filterOptions.find((o) => o.isAll) ?? filterOptions[0] ?? null;
    }
    return filterOptions.find((o) => o.id === selectedWorkItemId) ?? null;
  }, [selectedWorkItemId, filterOptions]);

  const filteredRuns = useMemo(() => {
    if (selectedWorkItemId === null) return runs;
    return runs.filter((run) => run.workItemId === selectedWorkItemId);
  }, [runs, selectedWorkItemId]);

  useEffect(() => {
    if (openId && filteredRuns.some((run) => run.id === openId)) return;
    setOpenId(filteredRuns[0]?.id ?? null);
  }, [filteredRuns, openId]);

  return (
    <div className="space-y-6">
      <PageHeader title="Runs">
        {runs.length > 0 && selectedFilterOption && (
          <Combobox
            items={filterOptions}
            value={selectedFilterOption}
            onValueChange={(option) => {
              if (!option || option.isAll) setSelectedWorkItemId(null);
              else setSelectedWorkItemId(option.id);
            }}
            isItemEqualToValue={(a, b) => a.id === b.id}
            itemToStringLabel={runsWorkItemFilterOptionLabel}
            filter={filterRunsWorkItemOptions}
          >
            <ComboboxInput
              placeholder="Filter by work item"
              className="min-w-[14rem] sm:min-w-[18rem]"
            />
            <ComboboxContent>
              <ComboboxEmpty>No matching work items.</ComboboxEmpty>
              <ComboboxList>
                {(option) => (
                  <ComboboxItem key={option.id} value={option}>
                    {option.isAll ? (
                      <span className="truncate">All runs</span>
                    ) : (
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate">{option.title}</span>
                        {option.url && (
                          <span className="shrink-0 text-muted-foreground">
                            {issueLabel(option.url)}
                          </span>
                        )}
                      </span>
                    )}
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        )}
      </PageHeader>
      {runs.length === 0 && <p className="text-sm text-muted-foreground">No runs yet.</p>}
      {runs.length > 0 && filteredRuns.length === 0 && (
        <p className="text-sm text-muted-foreground">No runs for this work item.</p>
      )}
      {filteredRuns.map((run) => {
        const open = openId === run.id;
        const runCost = formatUsd(run.costUsd);
        const decision =
          run.decision?.action &&
          `${run.decision.action}${run.decision.agent ? ` → ${run.decision.agent}` : ""}${
            run.decision.note ? `: ${run.decision.note}` : ""
          }`;
        return (
          <Collapsible
            key={run.id}
            open={open}
            onOpenChange={(next) => setOpenId(next ? run.id : null)}
          >
            <Card
              size="sm"
              className={cn(
                "py-0",
                run.status === "running" && "status-live-card",
              )}
            >
              <CollapsibleTrigger className="flex w-full items-center gap-2 px-4 py-3 text-left">
                <LiveSurface active={run.status === "running"} className="pl-2">
                  <span className="font-medium">{run.agentName}</span>
                </LiveSurface>
                <StatusBadge status={run.status} />
                <span className="truncate text-sm text-muted-foreground">
                  {run.harness} / {run.model}
                </span>
                {decision && (
                  <span className="hidden truncate text-sm text-muted-foreground md:inline">
                    {decision}
                  </span>
                )}
                {runCost && (
                  <span className="text-sm text-muted-foreground">{runCost}</span>
                )}
                <span className="ml-auto flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  {new Date(run.startedAt).toLocaleString()}
                  <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
                </span>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="grid gap-3 border-t pt-3 pb-4">
                  <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                    <Link
                      to={`/p/${projectId}/work/${run.workItemId}`}
                      className="underline-offset-4 hover:underline"
                    >
                      Work item
                    </Link>
                    {run.finishedAt && (
                      <span>Finished {new Date(run.finishedAt).toLocaleString()}</span>
                    )}
                  </div>
                  {run.error && (
                    <Alert variant="destructive">
                      <AlertDescription>{run.error}</AlertDescription>
                    </Alert>
                  )}
                  <PreBlock>{run.transcript?.trim() || "(no transcript yet)"}</PreBlock>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        );
      })}
    </div>
  );
}
