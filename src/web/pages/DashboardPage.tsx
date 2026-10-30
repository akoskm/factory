import { useEffect, useState } from "react";
import { api, fmtDuration, type Metrics } from "../api";
import { useProjectId } from "../App";

export function DashboardPage() {
  const projectId = useProjectId();
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [days, setDays] = useState(7);

  useEffect(() => {
    void api<Metrics>(`/api/projects/${projectId}/metrics?days=${days}`).then(setMetrics);
  }, [projectId, days]);

  if (!metrics) return <p className="muted">Loading metrics…</p>;

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1 style={{ margin: 0 }}>Productivity</h1>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>Last 7 days</option>
          <option value={14}>Last 14 days</option>
          <option value={30}>Last 30 days</option>
        </select>
      </div>
      <div className="cards">
        <div className="card">
          <h3>Median cycle time</h3>
          <div className="metric">{fmtDuration(metrics.cycleTime.kickoffToMergeMs)}</div>
          <div className="sub">Kickoff → merge</div>
          <div className="sub">Kickoff → PR: {fmtDuration(metrics.cycleTime.kickoffToPrMs)}</div>
          <div className="sub">
            PR → first review: {fmtDuration(metrics.cycleTime.prToFirstReviewMs)}
          </div>
          <div className="sub">
            First review → merge: {fmtDuration(metrics.cycleTime.firstReviewToMergeMs)}
          </div>
        </div>
        <div className="card">
          <h3>Pull requests</h3>
          <div className="metric">{metrics.pullRequests.opened}</div>
          <div className="sub">{metrics.pullRequests.merged} merged</div>
        </div>
        <div className="card">
          <h3>Total runs</h3>
          <div className="metric">
            {metrics.runsByAgent.reduce((s, r) => s + Number(r.count), 0)}
          </div>
          <div className="sub">
            {metrics.runsByAgent.map((r) => `${r.agentName}: ${r.count}`).join(" · ") || "—"}
          </div>
        </div>
        <div className="card">
          <h3>Cost</h3>
          <div className="metric">
            {metrics.totalCostUsd > 0 ? `$${metrics.totalCostUsd.toFixed(2)}` : "—"}
          </div>
          <div className="sub">From harness usage when reported</div>
        </div>
      </div>
    </div>
  );
}
