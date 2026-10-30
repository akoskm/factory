import { useEffect, useState } from "react";
import { api } from "../api";
import { useProjectId } from "../App";

type Source = {
  id: string;
  name: string;
  kind: string;
  config: { owner: string; repo: string; label: string };
  enabled: boolean;
};

export function SourcesPage() {
  const projectId = useProjectId();
  const [sources, setSources] = useState<Source[]>([]);
  const [form, setForm] = useState({
    name: "GitHub",
    owner: "",
    repo: "",
    label: "factory",
    token: "",
  });

  async function load() {
    setSources(await api<Source[]>(`/api/projects/${projectId}/sources`));
  }

  useEffect(() => {
    void load();
  }, [projectId]);

  return (
    <div className="stack">
      <h1>Sources</h1>
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Kind</th>
            <th>Target</th>
            <th>Label</th>
          </tr>
        </thead>
        <tbody>
          {sources.map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td>{s.kind}</td>
              <td>
                {s.config.owner}/{s.config.repo}
              </td>
              <td>{s.config.label}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="card stack">
        <h3>Add GitHub source</h3>
        {(["name", "owner", "repo", "label", "token"] as const).map((key) => (
          <input
            key={key}
            type={key === "token" ? "password" : "text"}
            placeholder={key}
            value={form[key]}
            onChange={(e) => setForm({ ...form, [key]: e.target.value })}
          />
        ))}
        <button
          className="primary"
          onClick={async () => {
            await api(`/api/projects/${projectId}/sources`, {
              method: "POST",
              body: JSON.stringify(form),
            });
            setForm({ name: "GitHub", owner: "", repo: "", label: "factory", token: "" });
            await load();
          }}
        >
          Add source
        </button>
      </div>
    </div>
  );
}
