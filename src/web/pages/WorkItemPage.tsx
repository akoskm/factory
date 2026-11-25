import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CircleDot } from "lucide-react";
import { formatUsd } from "@/format-usd";
import { agentTypeByName } from "../agent-mark";
import { api, type ConfigAgentsResponse, type WorkItemArtifact } from "../api";
import { PageHeader } from "@/components/page-header";
import { PrLink } from "@/components/pr-link";
import { PipelineFlow } from "@/components/pipeline-flow";
import { WorkItemChat } from "@/components/work-item-chat";
import type { PipelineView } from "../pipeline-graph";
import { useProjectId } from "../use-project-id";
import { issueLabel } from "../issue-label";
import { displayError, runIdForNote } from "../work-item-overview";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { QueueActions } from "@/components/queue-actions";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

type Detail = {
  id: string;
  title: string;
  url: string;
  body: string;
  status: string;
  phase: string;
  currentAgent: string | null;
  waitingForReview: boolean;
  takenOver?: boolean;
  learnError: string | null;
  prUrl: string | null;
  branch: string | null;
  queuedAt: string | null;
  scheduledFor: string | null;
  error: string | null;
  artifacts: WorkItemArtifact[];
  runs: {
    id: string;
    agentName: string;
    harness: string;
    model: string;
    status: string;
    transcript: string;
    startedAt: string;
    finishedAt: string | null;
    decision: { action: string; agent?: string; note?: string } | null;
    costUsd: string | null;
    error: string | null;
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

type RecoverAction = "retry_last" | "retry_foreman" | "reset_branch";

export function WorkItemPage() {
  const projectId = useProjectId();
  const { workItemId } = useParams();
  const [item, setItem] = useState<Detail | null>(null);
  const [pipeline, setPipeline] = useState<PipelineView | null>(null);
  const [agentTypes, setAgentTypes] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [recovering, setRecovering] = useState<RecoverAction | null>(null);
  const [recoverError, setRecoverError] = useState<string | null>(null);
  const [queueBusy, setQueueBusy] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleAt, setScheduleAt] = useState(() => {
    const d = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });

  useEffect(() => {
    void api<ConfigAgentsResponse>(`/api/projects/${projectId}/agents`)
      .then((data) => {
        setPipeline(data.pipeline);
        setAgentTypes(agentTypeByName(data.agents));
      })
      .catch(() => setPipeline(null));
  }, [projectId]);

  async function load() {
    setItem(await api<Detail>(`/api/work-items/${workItemId}`));
  }

  useEffect(() => {
    void load();
  }, [workItemId]);

  useEffect(() => {
    if (
      !item ||
      (item.status !== "running" &&
        item.status !== "queued" &&
        item.status !== "waiting_review" &&
        item.status !== "needs_user" &&
        item.status !== "merged")
    ) {
      return;
    }
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

  async function enqueue(mode: "queue" | "queue_and_start" | "schedule"): Promise<boolean> {
    if (!item) return false;
    setQueueBusy(true);
    setQueueError(null);
    try {
      await api(`/api/work-items/${item.id}/queue`, {
        method: "POST",
        body: JSON.stringify(
          mode === "schedule"
            ? { mode, scheduledFor: new Date(scheduleAt).toISOString() }
            : { mode },
        ),
      });
      await load();
      return true;
    } catch (err) {
      setQueueError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setQueueBusy(false);
    }
  }

  if (!item) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const notesByRun = new Map<string, WorkItemArtifact>();
  for (const art of item.artifacts) {
    const runId = runIdForNote(art, item.runs);
    if (runId) notesByRun.set(runId, art);
  }

  const costLabel = taskCost(item.runs);
  const lastAgent = item.currentAgent ?? "foreman";
  const phase = item.phase || "step";
  const resumeShip = phase === "ship" || phase === "integrate" || phase === "recheck";
  const runAgainLabel =
    phase === "on_complete"
      ? "Retry the finish steps"
      : resumeShip
        ? "Update branch and ship"
        : lastAgent === "foreman"
          ? "Run the foreman again"
          : `Run ${lastAgent} again`;
  const showAskForeman = phase === "step" && lastAgent !== "foreman";
  // Ship / review holds use cards only when not in steer takeover (Steer is the one human box).
  const takenOver = Boolean(item.takenOver);
  const shipHold = item.status === "needs_user" && item.phase === "ship" && !takenOver;
  const reviewHold = item.status === "waiting_review" && !takenOver;
  const canTakeOver =
    item.status !== "completed" && item.status !== "merged" && !takenOver;
  const canQueue = item.status === "listed" || item.status === "scheduled";
  const canDequeue = item.status === "queued" || item.status === "scheduled";

  async function dequeue() {
    if (!item) return;
    setQueueBusy(true);
    setQueueError(null);
    try {
      await api(`/api/work-items/${item.id}/dequeue`, { method: "POST" });
      await load();
    } catch (err) {
      setQueueError(err instanceof Error ? err.message : String(err));
    } finally {
      setQueueBusy(false);
    }
  }

  return (
    <div className="space-y-6 pb-8">
      <div className="space-y-3">
        <PageHeader title={item.title} />
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={item.status} />
          {item.status === "scheduled" && item.scheduledFor && (
            <span className="text-sm text-muted-foreground">
              at {new Date(item.scheduledFor).toLocaleString()}
            </span>
          )}
          {item.status === "queued" && (
            <span className="text-sm text-muted-foreground">
              {item.queuedAt
                ? `since ${new Date(item.queuedAt).toLocaleString()} · waiting for a free slot`
                : "waiting for a free slot"}
            </span>
          )}
          {item.url && (
            <PrLink href={item.url} label={issueLabel(item.url)} icon={<CircleDot />} />
          )}
          {item.prUrl && <PrLink href={item.prUrl} />}
          {costLabel && <span className="text-sm text-muted-foreground">{costLabel}</span>}
        </div>
      </div>
      {(canQueue || canDequeue) && (
        <Card>
          <CardHeader>
            <CardTitle>{canDequeue && !canQueue ? "On the factory queue" : "Factory queue"}</CardTitle>
            <p className="text-sm text-muted-foreground">
              {canDequeue && !canQueue
                ? "Not started yet — remove to pull it off the backlog."
                : "Queue puts it on the backlog. Chevron: start now if a slot is free, or schedule for later."}
            </p>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-3">
            {canQueue && (
              <QueueActions
                size="default"
                disabled={queueBusy}
                onQueue={() => void enqueue("queue")}
                onQueueAndStart={() => void enqueue("queue_and_start")}
                onSchedule={() => setScheduleOpen(true)}
              />
            )}
            {canDequeue && (
              <Button
                size="default"
                variant="outline"
                disabled={queueBusy}
                onClick={() => void dequeue()}
              >
                Remove from queue
              </Button>
            )}
            {queueError && <p className="w-full text-sm text-destructive">{queueError}</p>}
          </CardContent>
        </Card>
      )}
      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Joins the queue at this time. Same as Queue, just delayed.
          </p>
          <div className="space-y-2">
            <Label htmlFor="wi-schedule-at">Start at</Label>
            <Input
              id="wi-schedule-at"
              type="datetime-local"
              value={scheduleAt}
              onChange={(e) => setScheduleAt(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setScheduleOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={queueBusy}
              onClick={() => {
                void enqueue("schedule").then((ok) => {
                  if (ok) setScheduleOpen(false);
                });
              }}
            >
              Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {pipeline && item.status !== "listed" && (
        <PipelineFlow
          pipeline={pipeline}
          status={item.status}
          currentAgent={item.currentAgent}
          agentTypes={agentTypes}
        />
      )}
      {item.learnError && item.status === "completed" && (
        <Alert>
          <AlertDescription className="whitespace-pre-wrap">
            Learn failed. {displayError(item.learnError)}
          </AlertDescription>
        </Alert>
      )}
      {item.error && item.status === "failed" && (
        <Alert variant="destructive">
          <AlertDescription className="whitespace-pre-wrap">{displayError(item.error)}</AlertDescription>
        </Alert>
      )}
      {item.status === "failed" && !takenOver && (
        <Card>
          <CardHeader>
            <CardTitle>Recover</CardTitle>
            <p className="text-sm text-muted-foreground">
              {phase === "on_complete"
                ? "The pull request merged. This retries the steps that run after merge."
                : resumeShip
                  ? "The branch still needs a ship. Updating it keeps the pull request."
                  : showAskForeman
                    ? `Run ${lastAgent} again repeats the failed step. Asking the foreman lets it choose a different step. The branch stays.`
                    : "Runs the foreman again on the same branch."}{" "}
              Closing the PR deletes the remote branch and starts this item over.
            </p>
          </CardHeader>
          <CardContent className="grid gap-3">
            {recoverError && (
              <Alert variant="destructive">
                <AlertDescription>{recoverError}</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="default"
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
                variant="outline"
                disabled={recovering !== null}
                onClick={() => void recover("reset_branch")}
              >
                {recovering === "reset_branch" ? "Resetting…" : "Close PR and start over"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      {shipHold && (
        <Card>
          <CardHeader>
            <CardTitle>Needs you</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {item.error && (
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{displayError(item.error)}</p>
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
                Continue
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
                Stop
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      {reviewHold && (
        <Card>
          <CardHeader>
            <CardTitle>Waiting for review</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {item.error && (
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{displayError(item.error)}</p>
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
                Approve
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
                Request changes
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      <WorkItemChat
        workItemId={item.id}
        status={item.status}
        takenOver={takenOver}
        canTakeOver={canTakeOver}
        onTakenOver={() => void load()}
        onPipelineContinued={() => void load()}
        runs={item.runs}
        notesByRun={notesByRun}
      />
    </div>
  );
}
