import { useEffect, useState } from "react";
import { api, type Agent } from "../api";
import { useProjectId } from "../App";

export function AgentsPage() {
  const projectId = useProjectId();
  const [agents, setAgents] = useState<Agent[]>([]);

  async function load() {
    setAgents(await api<Agent[]>(`/api/projects/${projectId}/agents`));
  }

  useEffect(() => {
    void load();
  }, [projectId]);

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>Agents</h1>
        <button
          onClick={async () => {
            await api(`/api/projects/${projectId}/agents/sync`, { method: "POST" });
            await load();
          }}
        >
          Sync from files
        </button>
      </div>
      {agents.map((agent) => (
        <div className="card stack" key={agent.id}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <strong>{agent.name}</strong>{" "}
              <span className="badge">{agent.agentType}</span>
              <div className="muted">{agent.description}</div>
            </div>
            <label className="toggle">
              <input
                type="checkbox"
                checked={agent.waitForReview}
                onChange={async (e) => {
                  await api(`/api/agents/${agent.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ waitForReview: e.target.checked }),
                  });
                  await load();
                }}
              />
              Wait for review
            </label>
          </div>
          <div className="row">
            <select
              value={agent.harness}
              onChange={async (e) => {
                await api(`/api/agents/${agent.id}`, {
                  method: "PATCH",
                  body: JSON.stringify({ harness: e.target.value }),
                });
                await load();
              }}
            >
              <option value="cursor">cursor</option>
              <option value="claude-code">claude-code</option>
            </select>
            <input
              value={agent.model}
              onChange={(e) => {
                const model = e.target.value;
                setAgents((prev) =>
                  prev.map((a) => (a.id === agent.id ? { ...a, model } : a)),
                );
              }}
              onBlur={async (e) => {
                await api(`/api/agents/${agent.id}`, {
                  method: "PATCH",
                  body: JSON.stringify({ model: e.target.value }),
                });
              }}
            />
          </div>
          <div className="pre">{agent.instructions}</div>
        </div>
      ))}
    </div>
  );
}
