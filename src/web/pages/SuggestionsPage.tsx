import { useEffect, useState } from "react";
import { api } from "../api";
import { useProjectId } from "../App";

type Suggestion = {
  id: string;
  title: string;
  body: string;
  prUrl: string | null;
  status: string;
  createdAt: string;
};

export function SuggestionsPage() {
  const projectId = useProjectId();
  const [rows, setRows] = useState<Suggestion[]>([]);

  useEffect(() => {
    void api<Suggestion[]>(`/api/projects/${projectId}/suggestions`).then(setRows);
  }, [projectId]);

  return (
    <div className="stack">
      <h1>Suggestions</h1>
      {rows.map((s) => (
        <div className="card stack" key={s.id}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>{s.title}</strong>
            {s.prUrl && (
              <a href={s.prUrl} target="_blank" rel="noreferrer">
                PR
              </a>
            )}
          </div>
          <div className="pre">{s.body}</div>
        </div>
      ))}
      {!rows.length && <p className="muted">No learning suggestions yet.</p>}
    </div>
  );
}
