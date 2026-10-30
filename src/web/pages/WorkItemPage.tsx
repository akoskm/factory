import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, type WorkItemArtifact } from "../api";

type Detail = {
  id: string;
  title: string;
  body: string;
  status: string;
  currentAgent: string | null;
  waitingForReview: boolean;
  prUrl: string | null;
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

export function WorkItemPage() {
  const { workItemId } = useParams();
  const [item, setItem] = useState<Detail | null>(null);
  const [note, setNote] = useState("");

  async function load() {
    setItem(await api<Detail>(`/api/work-items/${workItemId}`));
  }

  useEffect(() => {
    void load();
  }, [workItemId]);

  if (!item) return <p className="muted">Loading…</p>;

  const orderedArtifacts = [...item.artifacts].sort((a, b) => {
    const order = ["triage", "spec"];
    return (order.indexOf(a.kind) === -1 ? 99 : order.indexOf(a.kind)) -
      (order.indexOf(b.kind) === -1 ? 99 : order.indexOf(b.kind));
  });

  return (
    <div className="stack">
      <h1>{item.title}</h1>
      <div className="row">
        <span className="badge">{item.status}</span>
        <span className="muted">{item.currentAgent}</span>
        {item.prUrl && (
          <a href={item.prUrl} target="_blank" rel="noreferrer">
            Pull request
          </a>
        )}
      </div>
      {item.error && <div style={{ color: "var(--danger)" }}>{item.error}</div>}
      {item.waitingForReview && (
        <div className="card stack">
          <strong>Waiting for review</strong>
          <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note" />
          <div className="row">
            <button
              className="primary"
              onClick={async () => {
                await api(`/api/work-items/${item.id}/review`, {
                  method: "POST",
                  body: JSON.stringify({ decision: "approve", note }),
                });
                await load();
              }}
            >
              Approve
            </button>
            <button
              onClick={async () => {
                await api(`/api/work-items/${item.id}/review`, {
                  method: "POST",
                  body: JSON.stringify({ decision: "request_changes", note }),
                });
                await load();
              }}
            >
              Request changes
            </button>
          </div>
        </div>
      )}
      {orderedArtifacts.map((art) => (
        <div className="card stack" key={art.id}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3 style={{ margin: 0 }}>{ARTIFACT_TITLES[art.kind] ?? art.kind}</h3>
            <span className="muted" style={{ fontSize: "0.8rem" }}>
              Updated {new Date(art.updatedAt).toLocaleString()}
            </span>
          </div>
          <div className="pre">{art.content}</div>
        </div>
      ))}
      <div className="card">
        <h3>Issue</h3>
        <div className="pre">{item.body || "(empty)"}</div>
      </div>
      <h2>Runs</h2>
      {item.runs.map((run) => (
        <div className="card stack" key={run.id}>
          <div className="row">
            <strong>{run.agentName}</strong>
            <span className="badge">{run.status}</span>
            {run.decision && (
              <span className="muted">
                {run.decision.action}
                {run.decision.agent ? ` → ${run.decision.agent}` : ""}
              </span>
            )}
          </div>
          <div className="pre">{run.transcript || "(no transcript)"}</div>
        </div>
      ))}
    </div>
  );
}
