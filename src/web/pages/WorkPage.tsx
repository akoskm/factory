import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type WorkItem } from "../api";
import { useProjectId } from "../App";

export function WorkPage() {
  const projectId = useProjectId();
  const [items, setItems] = useState<WorkItem[]>([]);

  useEffect(() => {
    void api<WorkItem[]>(`/api/projects/${projectId}/work-items`).then(setItems);
  }, [projectId]);

  return (
    <div className="stack">
      <h1>Work</h1>
      <table className="table">
        <thead>
          <tr>
            <th>Title</th>
            <th>Status</th>
            <th>Agent</th>
            <th>PR</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>
                <Link to={`/p/${projectId}/work/${item.id}`}>{item.title}</Link>
              </td>
              <td>
                <span className="badge">{item.status}</span>
                {item.waitingForReview && <span className="badge"> needs review</span>}
              </td>
              <td>{item.currentAgent ?? "—"}</td>
              <td>
                {item.prUrl ? (
                  <a href={item.prUrl} target="_blank" rel="noreferrer">
                    PR
                  </a>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
