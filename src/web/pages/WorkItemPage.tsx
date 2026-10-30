import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Bot } from "lucide-react";
import { api, type WorkItemArtifact } from "../api";
import { PageHeader } from "@/components/page-header";
import { PrLink } from "@/components/pr-link";
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
  }[];
};

const ARTIFACT_TITLES: Record<string, string> = {
  spec: "Spec",
  triage: "Triage",
};

type RecoverAction = "retry_last" | "retry_foreman" | "reset_branch";

function recoverHint(error: string | null): RecoverAction | null {
  if (!error) return null;
  const e = error.toLowerCase();
  if (e.includes("non-fast-forward") || e.includes("rejected") || e.includes("fetch first")) {
    return "reset_branch";
  }
  return "retry_last";
}

export function WorkItemPage() {
  const { workItemId } = useParams();
  const [item, setItem] = useState<Detail | null>(null);
  const [note, setNote] = useState("");
  const [recovering, setRecovering] = useState<RecoverAction | null>(null);
  const [recoverError, setRecoverError] = useState<string | null>(null);

  async function load() {
    setItem(await api<Detail>(`/api/work-items/${workItemId}`));
  }

  useEffect(() => {
    void load();
  }, [workItemId]);

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

  const hint = recoverHint(item.error);
  const lastAgent = item.currentAgent ?? "foreman";

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
          {item.prUrl && <PrLink href={item.prUrl} />}
        </div>
      </div>
      {item.error && (
        <Alert variant="destructive">
          <AlertDescription>{item.error}</AlertDescription>
        </Alert>
      )}
      {item.status === "failed" && (
        <Card>
          <CardHeader>
            <CardTitle>Recover</CardTitle>
            <p className="text-sm text-muted-foreground">
              Workflow stopped. Retry keeps artifacts
              {item.branch ? ` and branch ${item.branch}` : ""}. Reset closes the PR and deletes
              the remote branch first.
            </p>
          </CardHeader>
          <CardContent className="grid gap-3">
            {hint === "reset_branch" && (
              <Badge variant="secondary">Suggested: reset branch (push rejected)</Badge>
            )}
            {hint === "retry_last" && (
              <Badge variant="secondary">Suggested: retry {lastAgent}</Badge>
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
                {recovering === "retry_last" ? "Starting…" : `Retry ${lastAgent}`}
              </Button>
              <Button
                variant="outline"
                disabled={recovering !== null}
                onClick={() => void recover("retry_foreman")}
              >
                {recovering === "retry_foreman" ? "Starting…" : "Retry from foreman"}
              </Button>
              <Button
                variant={hint === "reset_branch" ? "default" : "outline"}
                disabled={recovering !== null}
                onClick={() => void recover("reset_branch")}
              >
                {recovering === "reset_branch" ? "Resetting…" : "Reset branch & retry"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
      {item.waitingForReview && (
        <Card>
          <CardHeader>
            <CardTitle>Waiting for review</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
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
        {item.runs.map((run) => (
          <Card
            key={run.id}
            size="sm"
            className={
              run.status === "running"
                ? "ring-1 ring-emerald-500/25 bg-emerald-500/[0.03]"
                : undefined
            }
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
              </div>
            </CardHeader>
            <CardContent>
              <PreBlock>{run.transcript || "(no transcript)"}</PreBlock>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
