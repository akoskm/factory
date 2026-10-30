import { useEffect, useState } from "react";
import { api, fmtDuration, type Metrics } from "../api";
import { useProjectId } from "../use-project-id";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function DashboardPage() {
  const projectId = useProjectId();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [days, setDays] = useState("7");

  useEffect(() => {
    void api<Metrics>(`/api/projects/${projectId}/metrics?days=${days}`).then(setMetrics);
  }, [projectId, days]);

  return (
    <div className="space-y-6">
      <PageHeader title="Productivity">
        <Select value={days} onValueChange={setDays}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="14">Last 14 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
          </SelectContent>
        </Select>
      </PageHeader>
      {!metrics ? (
        <p className="text-sm text-muted-foreground">Loading metrics…</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card>
            <CardHeader>
              <CardTitle>Median cycle time</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm text-muted-foreground">
              <div className="text-3xl font-semibold tracking-tight text-foreground">
                {fmtDuration(metrics.cycleTime.kickoffToMergeMs)}
              </div>
              <div>Kickoff → merge</div>
              <div>Kickoff → PR: {fmtDuration(metrics.cycleTime.kickoffToPrMs)}</div>
              <div>PR → first review: {fmtDuration(metrics.cycleTime.prToFirstReviewMs)}</div>
              <div>First review → merge: {fmtDuration(metrics.cycleTime.firstReviewToMergeMs)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Pull requests</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <div className="text-3xl font-semibold tracking-tight">
                {metrics.pullRequests.opened}
              </div>
              <div className="text-sm text-muted-foreground">
                {metrics.pullRequests.merged} merged
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Total runs</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <div className="text-3xl font-semibold tracking-tight">
                {metrics.runsByAgent.reduce((s, r) => s + Number(r.count), 0)}
              </div>
              <div className="text-sm text-muted-foreground">
                {metrics.runsByAgent.map((r) => `${r.agentName}: ${r.count}`).join(" · ") || "—"}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Cost</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              <div className="text-3xl font-semibold tracking-tight">
                {metrics.totalCostUsd > 0 ? `$${metrics.totalCostUsd.toFixed(2)}` : "—"}
              </div>
              <div className="text-sm text-muted-foreground">From harness usage when reported</div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
