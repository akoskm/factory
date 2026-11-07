import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ChevronDown, CircleDot } from "lucide-react";
import { cn } from "cn";
import { formatUsd } from "@/format-usd";
import { agentTypeByName } from "../agent-mark";
import { api, type ConfigAgentsResponse, type WorkItemArtifact } from "../api";
import { PageHeader } from "@/components/page-header";
import { PrLink } from "@/components/pr-link";
import { PipelineFlow } from "@/components/pipeline-flow";
import type { PipelineView } from "../pipeline-graph";
import { useProjectId } from "../use-project-id";
import { issueLabel } from "../issue-label";
import {
  displayError,
  runHeadline,
  runIdForNote,
  runsChronological,
  runsOverview,
} from "../work-item-overview";
import { MarkdownBlock, MarkdownToggle } from "@/components/markdown-block";
import { PreBlock } from "@/components/pre-block";
import { LiveSurface, StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

type Detail = {
  id: string;
  title: string;
  url: string;
  body: string;
  status: string;
  phase: string;
  currentAgent: string | null;
  waitingForReview: boolean;
  learnError: string | null;
  prUrl: string | null;
  branch: string | null;
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
  const holding = item.status === "waiting_review" || item.status === "needs_user";

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <PageHeader title={item.title} />
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={item.status} />
          {item.url && (
            <PrLink href={item.url} label={issueLabel(item.url)} icon={<CircleDot />} />
          )}
          {item.prUrl && <PrLink href={item.prUrl} />}
          {costLabel && <span className="text-sm text-muted-foreground">{costLabel}</span>}
        </div>
      </div>
      {pipeline && (
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
      {item.status === "failed" && (
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
      {holding && (
        <Card>
          <CardHeader>
            <CardTitle>{item.status === "needs_user" ? "Needs you" : "Waiting for review"}</CardTitle>
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
                {item.status === "needs_user" ? "Continue" : "Approve"}
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
                {item.status === "needs_user" ? "Stop" : "Request changes"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      <RunsSection runs={item.runs} notesByRun={notesByRun} />
    </div>
  );
}

function RunsSection({
  runs,
  notesByRun,
}: {
  runs: Detail["runs"];
  notesByRun: Map<string, WorkItemArtifact>;
}) {
  const ordered = runsChronological(runs);
  const showCost = ordered.some((run) => formatUsd(run.costUsd));
  const columns = showCost ? 6 : 5;
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="font-heading text-lg font-semibold tracking-tight">Agent runs</h2>
        <p className="max-w-2xl text-sm text-muted-foreground">{runsOverview(runs)}</p>
      </div>
      <Card className="min-w-0 py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Agent</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Summary</TableHead>
              <TableHead>Started</TableHead>
              {showCost && <TableHead className="text-right">Cost</TableHead>}
              <TableHead className="w-10 pr-4">
                <span className="sr-only">Details</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ordered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns} className="py-8 text-center text-muted-foreground">
                  No agents have run on this item yet.
                </TableCell>
              </TableRow>
            ) : (
              ordered.map((run) => (
                <RunTableRows
                  key={run.id}
                  run={run}
                  note={notesByRun.get(run.id) ?? null}
                  showCost={showCost}
                  columns={columns}
                />
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </section>
  );
}

function RunTableRows({
  run,
  note,
  showCost,
  columns,
}: {
  run: Detail["runs"][number];
  note: WorkItemArtifact | null;
  showCost: boolean;
  columns: number;
}) {
  const [open, setOpen] = useState(run.status === "running");
  const [source, setSource] = useState(false);
  const runCost = formatUsd(run.costUsd);
  const error = run.error ? displayError(run.error) : null;

  function toggle() {
    setOpen((value) => !value);
  }

  return (
    <>
      <TableRow
        className={cn("cursor-pointer", run.status === "running" && "status-live-row")}
        aria-expanded={open}
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggle();
          }
        }}
      >
        <TableCell className="pl-4 font-medium">
          <LiveSurface active={run.status === "running"} className="pl-2">
            {run.agentName}
          </LiveSurface>
        </TableCell>
        <TableCell>
          <StatusBadge status={run.status} />
        </TableCell>
        <TableCell className="max-w-md whitespace-normal text-muted-foreground">
          {runHeadline(run)}
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {new Date(run.startedAt).toLocaleString()}
        </TableCell>
        {showCost && (
          <TableCell className="text-right text-muted-foreground">{runCost ?? "—"}</TableCell>
        )}
        <TableCell className="pr-4">
          <ChevronDown
            className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")}
          />
        </TableCell>
      </TableRow>
      {open && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={columns} className="px-4 py-3 whitespace-normal">
            <div className="grid gap-3">
              {note && (
                <div className="grid gap-2">
                  <div className="flex justify-end">
                    <MarkdownToggle source={source} onChange={setSource} />
                  </div>
                  <MarkdownBlock markdown={note.content} source={source} />
                </div>
              )}
              <p className="text-sm text-muted-foreground">
                {run.harness} / {run.model}
                {run.finishedAt ? ` · finished ${new Date(run.finishedAt).toLocaleString()}` : ""}
              </p>
              {error && (
                <Alert variant="destructive">
                  <AlertDescription className="whitespace-pre-wrap">{error}</AlertDescription>
                </Alert>
              )}
              <PreBlock>
                {run.transcript.trim() ? displayError(run.transcript) : "(no transcript)"}
              </PreBlock>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
