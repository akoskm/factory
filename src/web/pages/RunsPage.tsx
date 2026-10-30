import { useEffect, useState } from "react";
import { api } from "../api";
import { useProjectId } from "../App";

type Run = {
  id: string;
  agentName: string;
  harness: string;
  model: string;
  status: string;
  costUsd: string | null;
  startedAt: string;
  workItemId: string;
};

export function RunsPage() {
  const projectId = useProjectId();
  const [runs, setRuns] = useState<Run[]>([]);

  useEffect(() => {
    void api<Run[]>(`/api/projects/${projectId}/runs`).then(setRuns);
  }, [projectId]);

  return (
    <div className="stack">
      <h1>Runs</h1>
      <table className="table">
        <thead>
          <tr>
            <th>Agent</th>
            <th>Harness</th>
            <th>Status</th>
            <th>Cost</th>
            <th>Started</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id}>
              <td>{run.agentName}</td>
              <td>
                {run.harness} / {run.model}
              </td>
              <td>
                <span className="badge">{run.status}</span>
              </td>
              <td>{run.costUsd ? `$${run.costUsd}` : "—"}</td>
              <td>{new Date(run.startedAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
