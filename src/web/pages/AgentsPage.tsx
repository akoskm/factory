import { useEffect, useState } from "react";
import { api, type Agent } from "../api";
import { useProjectId } from "../App";

const MODELS_BY_HARNESS: Record<string, string[]> = {
  cursor: ["composer-2", "auto"],
  "claude-code": ["claude-sonnet-4-5", "claude-opus-4-5", "claude-haiku-4-5"],
};

function defaultModel(harness: string): string {
  return MODELS_BY_HARNESS[harness]?.[0] ?? "composer-2";
}

function modelsFor(harness: string, current: string): string[] {
  const list = MODELS_BY_HARNESS[harness] ?? [current];
  return list.includes(current) ? list : [current, ...list];
}

function waitMode(agent: Agent): "default" | "always" | "never" {
  if (agent.waitForReview === true) return "always";
  if (agent.waitForReview === false) return "never";
  return "default";
}

export function AgentsPage() {
  const projectId = useProjectId();
  const [agents, setAgents] = useState<Agent[]>([]);

  async function load() {
    setAgents(await api<Agent[]>(`/api/projects/${projectId}/agents`));
  }

  useEffect(() => {
    void load();
  }, [projectId]);

  async function patchAgent(id: string, body: Record<string, unknown>) {
    await api(`/api/agents/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    await load();
  }

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>Agents</h1>
        <button
          type="button"
          onClick={async () => {
            await api(`/api/projects/${projectId}/agents/sync`, { method: "POST" });
            await load();
          }}
        >
          Sync from files
        </button>
      </div>
      <p className="muted">
        Wait mode: Default inherits Factory defaults (Settings). Always / Never override for this
        project.
      </p>
      {agents.map((agent) => {
        const models = modelsFor(agent.harness, agent.model);
        const invalidPair = !(MODELS_BY_HARNESS[agent.harness] ?? []).includes(agent.model);
        return (
          <div className="card stack" key={agent.id}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <strong>{agent.name}</strong>{" "}
                <span className="badge">{agent.agentType}</span>
                <div className="muted">{agent.description}</div>
              </div>
              <div className="row">
                <label className="stack" style={{ gap: "0.2rem" }}>
                  <span className="muted" style={{ fontSize: "0.8rem" }}>
                    Wait for review
                  </span>
                  <select
                    value={waitMode(agent)}
                    onChange={(e) => {
                      const mode = e.target.value as "default" | "always" | "never";
                      const waitForReview =
                        mode === "default" ? null : mode === "always";
                      void patchAgent(agent.id, { waitForReview });
                    }}
                  >
                    <option value="default">
                      Default ({agent.instanceDefault ? "wait" : "continue"})
                    </option>
                    <option value="always">Always wait</option>
                    <option value="never">Never wait</option>
                  </select>
                </label>
                <span className="badge">
                  effective: {agent.effectiveWaitForReview ? "wait" : "continue"}
                </span>
              </div>
            </div>
            <div className="row">
              <select
                value={agent.harness}
                onChange={(e) => {
                  const harness = e.target.value;
                  void patchAgent(agent.id, {
                    harness,
                    model: defaultModel(harness),
                  });
                }}
              >
                <option value="cursor">cursor</option>
                <option value="claude-code">claude-code</option>
              </select>
              <select
                value={agent.model}
                onChange={(e) => void patchAgent(agent.id, { model: e.target.value })}
              >
                {models.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </div>
            {invalidPair && (
              <div style={{ color: "var(--danger)" }}>
                Model {agent.model} is not valid for {agent.harness}. Pick another model.
              </div>
            )}
            <div className="pre">{agent.instructions}</div>
          </div>
        );
      })}
    </div>
  );
}
