import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { cn } from "cn";
import { api } from "../api";
import { useProjectId } from "../use-project-id";
import { PageHeader } from "@/components/page-header";
import { PreBlock } from "@/components/pre-block";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

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
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    void api<Run[]>(`/api/projects/${projectId}/runs`).then((rows) => {
      setRuns(rows);
      if (rows[0]) setOpenId(rows[0].id);
    });
  }, [projectId]);

  return (
    <div className="space-y-6">
      <PageHeader title="Runs" />
      {runs.length === 0 && <p className="text-sm text-muted-foreground">No runs yet.</p>}
      {runs.map((run) => {
        const open = openId === run.id;
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
            <Card size="sm" className="py-0">
              <CollapsibleTrigger className="flex w-full items-center gap-2 px-4 py-3 text-left">
                <span className="font-medium">{run.agentName}</span>
                <StatusBadge status={run.status} />
                <span className="truncate text-sm text-muted-foreground">
                  {run.harness} / {run.model}
                </span>
                {decision && (
                  <span className="hidden truncate text-sm text-muted-foreground md:inline">
                    {decision}
                  </span>
                )}
                {run.costUsd && (
                  <span className="text-sm text-muted-foreground">${run.costUsd}</span>
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
