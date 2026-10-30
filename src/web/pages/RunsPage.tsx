import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useProjectId } from "../App";

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
    <div className="stack">
      <h1>Runs</h1>
      {runs.length === 0 && <p className="muted">No runs yet.</p>}
      {runs.map((run) => {
        const open = openId === run.id;
        const decision =
          run.decision?.action &&
          `${run.decision.action}${run.decision.agent ? ` → ${run.decision.agent}` : ""}${
            run.decision.note ? `: ${run.decision.note}` : ""
          }`;
        return (
          <div className="card stack" key={run.id}>
            <button
              type="button"
              className="run-header"
              onClick={() => setOpenId(open ? null : run.id)}
              aria-expanded={open}
            >
              <span className="row" style={{ flex: 1 }}>
                <strong>{run.agentName}</strong>
                <span className="badge">{run.status}</span>
                <span className="muted">
                  {run.harness} / {run.model}
                </span>
                {decision && <span className="muted">{decision}</span>}
                {run.costUsd && <span className="muted">${run.costUsd}</span>}
              </span>
              <span className="muted">
                {new Date(run.startedAt).toLocaleString()}
                {open ? " ▾" : " ▸"}
              </span>
            </button>
            {open && (
              <div className="stack">
                <div className="row muted" style={{ fontSize: "0.85rem" }}>
                  <Link to={`/p/${projectId}/work/${run.workItemId}`}>Work item</Link>
                  {run.finishedAt && <span>Finished {new Date(run.finishedAt).toLocaleString()}</span>}
                </div>
                {run.error && <div style={{ color: "var(--danger)" }}>{run.error}</div>}
                <div className="pre">{run.transcript?.trim() || "(no transcript yet)"}</div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
