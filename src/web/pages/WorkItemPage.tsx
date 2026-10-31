import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Bot, CircleDot } from "lucide-react";
import { formatUsd } from "@/format-usd";
import { api, type ConfigAgentsResponse, type WorkItemArtifact } from "../api";
import { PageHeader } from "@/components/page-header";
import { PrLink } from "@/components/pr-link";
import { PipelineFlow } from "@/components/pipeline-flow";
import type { PipelineView } from "../pipeline-graph";
import { useProjectId } from "../use-project-id";
import { issueLabel } from "../issue-label";
import { PreBlock } from "@/components/pre-block";
import { LiveSurface, StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

type Detail = {
  id: string;
  title: string;
  url: string;
  body: string;
  status: string;
  currentAgent: string | null;
  waitingForReview: boolean;
  prUrl: string | null;
  branch: string | null;
  error: string | null;
  artifacts: WorkItemArtifact[];
  runs: {
    id: string;
    agentName: string;
    status: string;
    transcript: string;
    startedAt: string;
    decision: { action: string; agent?: string; note?: string } | null;
    costUsd: string | null;
  }[];
};

function taskCost(runs: { costUsd: string | null }[]): string | null {
  let sum = 0;
  let any = false;
  for (const run of runs) {
    if (run.costUsd == null || run.costUsd === "") continue;
    const n = Number(run.costUsd);
    if (!Number.isFinite(n)) continue;
    sum += n;
    any = true;
  }
  return any ? formatUsd(sum) : null;
}

const ARTIFACT_TITLES: Record<string, string> = {
  spec: "Spec",
  triage: "Triage",
};

type RecoverAction = "retry_last" | "retry_foreman" | "reset_branch";

function recoverHint(error: string | null): RecoverAction | null {
  if (!error) return null;
  return "retry_last";
}

export function WorkItemPage() {
  const projectId = useProjectId();
  const { workItemId } = useParams();
  const [item, setItem] = useState<Detail | null>(null);
  const [pipeline, setPipeline] = useState<PipelineView | null>(null);
  const [note, setNote] = useState("");
  const [recovering, setRecovering] = useState<RecoverAction | null>(null);
  const [recoverError, setRecoverError] = useState<string | null>(null);

  useEffect(() => {
    void api<ConfigAgentsResponse>(`/api/projects/${projectId}/agents`)
      .then((data) => setPipeline(data.pipeline))
      .catch(() => setPipeline(null));
  }, [projectId]);

  async function load() {
    setItem(await api<Detail>(`/api/work-items/${workItemId}`));
  }

  useEffect(() => {
    void load();
  }, [workItemId]);

  useEffect(() => {
    if (!item || (item.status !== "running" && item.status !== "queued")) return;
    const timer = setInterval(() => void load(), 3000);
    return () => clearInterval(timer);
  }, [item?.status, workItemId]);

  async function recover(action: RecoverAction) {
    if (!item) return;
    setRecovering(action);
    setRecoverError(null);
    try {
      await api(`/api/work-items/${item.id}/recover`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      await load();
    } catch (err) {
      setRecoverError(err instanceof Error ? err.message : String(err));
    } finally {
      setRecovering(null);
    }
  }

  if (!item) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const orderedArtifacts = [...item.artifacts].sort((a, b) => {
    const order = ["triage", "spec"];
    return (
      (order.indexOf(a.kind) === -1 ? 99 : order.indexOf(a.kind)) -
      (order.indexOf(b.kind) === -1 ? 99 : order.indexOf(b.kind))
    );
  });

  const costLabel = taskCost(item.runs);
  const hint = recoverHint(item.error);
  const lastAgent = item.currentAgent ?? "foreman";
  const resumeShip =
    Boolean(item.prUrl) &&
    /activity task failed|merge conflict|not mergeable|behind/i.test(item.error ?? "");
  const runAgainLabel = resumeShip
    ? "Update branch and ship"
    : lastAgent === "foreman"
      ? "Run the foreman again"
      : `Run ${lastAgent} again`;
  const showAskForeman = !resumeShip && lastAgent !== "foreman";

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <PageHeader title={item.title} />
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={item.status} />
          {item.currentAgent && (
            <Badge variant="secondary">
              <Bot />
              {item.currentAgent}
            </Badge>
          )}
          {item.url && (
            <PrLink href={item.url} label={issueLabel(item.url)} icon={<CircleDot />} />
          )}
          {item.prUrl && <PrLink href={item.prUrl} />}
          {costLabel && <span className="text-sm text-muted-foreground">{costLabel}</span>}
        </div>
      </div>
      {pipeline && (
        <PipelineFlow pipeline={pipeline} status={item.status} currentAgent={item.currentAgent} />
      )}
      {item.error && item.status === "failed" && (
        <Alert variant="destructive">
          <AlertDescription className="whitespace-pre-wrap">{item.error}</AlertDescription>
        </Alert>
      )}
      {item.status === "failed" && (
        <Card>
          <CardHeader>
            <CardTitle>Recover</CardTitle>
            <p className="text-sm text-muted-foreground">
              {resumeShip
                ? "The branch is behind main. Updating it keeps the pull request."
                : showAskForeman
                  ? `Run ${lastAgent} again repeats the failed step. Asking the foreman lets it choose a different step. The branch stays.`
                  : "Runs the foreman again on the same branch."}{" "}
              Closing the PR deletes the remote branch and starts this item over.
            </p>
          </CardHeader>
          <CardContent className="grid gap-3">
            {hint === "reset_branch" && (
              <Badge variant="secondary">Suggested: reset branch (push rejected)</Badge>
            )}
            {hint === "retry_last" && (
              <Badge variant="secondary">Suggested: {runAgainLabel}</Badge>
            )}
            {recoverError && (
              <Alert variant="destructive">
                <AlertDescription>{recoverError}</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant={hint === "retry_last" ? "default" : "outline"}
                disabled={recovering !== null}
                onClick={() => void recover("retry_last")}
              >
                {recovering === "retry_last" ? "Starting…" : runAgainLabel}
              </Button>
              {showAskForeman && (
                <Button
                  variant="outline"
                  disabled={recovering !== null}
                  onClick={() => void recover("retry_foreman")}
                >
                  {recovering === "retry_foreman" ? "Starting…" : "Ask the foreman what to do next"}
                </Button>
              )}
              <Button
                variant={hint === "reset_branch" ? "default" : "outline"}
                disabled={recovering !== null}
                onClick={() => void recover("reset_branch")}
              >
                {recovering === "reset_branch" ? "Resetting…" : "Close PR and start over"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      {item.waitingForReview && (
        <Card>
          <CardHeader>
            <CardTitle>{item.error ? "Needs you" : "Waiting for review"}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {item.error && (
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{item.error}</p>
            )}
            <Textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Note"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={async () => {
                  await api(`/api/work-items/${item.id}/review`, {
                    method: "POST",
                    body: JSON.stringify({ decision: "approve", note }),
                  });
                  await load();
                }}
              >
                {item.error ? "Continue" : "Approve"}
              </Button>
              <Button
                variant="outline"
                onClick={async () => {
                  await api(`/api/work-items/${item.id}/review`, {
                    method: "POST",
                    body: JSON.stringify({ decision: "request_changes", note }),
                  });
                  await load();
                }}
              >
                {item.error ? "Stop" : "Request changes"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      {orderedArtifacts.map((art) => (
        <Card key={art.id}>
          <CardHeader>
            <CardTitle>{ARTIFACT_TITLES[art.kind] ?? art.kind}</CardTitle>
            <p className="text-xs text-muted-foreground">
              Updated {new Date(art.updatedAt).toLocaleString()}
            </p>
          </CardHeader>
          <CardContent>
            <PreBlock>{art.content}</PreBlock>
          </CardContent>
        </Card>
      ))}
      <Card>
        <CardHeader>
          <CardTitle>Issue</CardTitle>
        </CardHeader>
        <CardContent>
          <PreBlock>{item.body || "(empty)"}</PreBlock>
        </CardContent>
      </Card>
      <div className="space-y-3">
        <h2 className="font-heading text-lg font-semibold tracking-tight">Runs</h2>
        {item.runs.map((run) => {
          const runCost = formatUsd(run.costUsd);
          return (
          <Card
            key={run.id}
            size="sm"
            className={run.status === "running" ? "status-live-card" : undefined}
          >
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <LiveSurface active={run.status === "running"} className="pl-2">
                  <CardTitle>{run.agentName}</CardTitle>
                </LiveSurface>
                <StatusBadge status={run.status} />
                {run.decision && (
                  <span className="text-sm text-muted-foreground">
                    {run.decision.action}
                    {run.decision.agent ? ` → ${run.decision.agent}` : ""}
                  </span>
                )}
                {runCost && (
                  <span className="text-sm text-muted-foreground">{runCost}</span>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <PreBlock>{run.transcript || "(no transcript)"}</PreBlock>
            </CardContent>
          </Card>
          );
        })}
      </div>
    </div>
  );
}
