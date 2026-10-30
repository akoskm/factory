import { useEffect, useState } from "react";
import { api, type AgentDefault } from "../api";
import { useProjectId } from "../App";

type SecretRow = { id: string; key: string; createdAt: string };

function StatusBadge({ present }: { present: boolean }) {
  return (
    <span
      className="badge"
      style={{
        background: present ? "rgba(62, 207, 142, 0.2)" : "rgba(240, 113, 120, 0.2)",
        color: present ? "var(--ok)" : "var(--danger)",
      }}
    >
      {present ? "Set" : "Not set"}
    </span>
  );
}

export function SettingsPage() {
  const projectId = useProjectId();
  const [keys, setKeys] = useState<SecretRow[]>([]);
  const [defaults, setDefaults] = useState<AgentDefault[]>([]);
  const [cursorKey, setCursorKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [status, setStatus] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);

  async function load() {
    const [secretRows, defaultRows] = await Promise.all([
      api<SecretRow[]>(`/api/projects/${projectId}/secrets`),
      api<AgentDefault[]>("/api/settings/agent-defaults"),
    ]);
    setKeys(secretRows);
    setDefaults(defaultRows);
  }

  useEffect(() => {
    void load().catch((err) => {
      setStatus({ kind: "err", text: err instanceof Error ? err.message : String(err) });
    });
  }, [projectId]);

  async function saveDefaults(next: AgentDefault[]) {
    setBusy(true);
    setStatus(null);
    try {
      const rows = await api<AgentDefault[]>("/api/settings/agent-defaults", {
        method: "PATCH",
        body: JSON.stringify({
          defaults: next.map((d) => ({
            agentName: d.agentName,
            waitForReview: d.waitForReview,
          })),
        }),
      });
      setDefaults(rows);
      setStatus({ kind: "ok", text: "Factory agent defaults saved" });
    } catch (err) {
      setStatus({ kind: "err", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  const cursor = keys.find((k) => k.key === "CURSOR_API_KEY");
  const anthropic = keys.find((k) => k.key === "ANTHROPIC_API_KEY");

  async function save(key: string, value: string, clear: () => void) {
    if (!value.trim()) {
      setStatus({ kind: "err", text: `${key} is empty` });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      await api(`/api/projects/${projectId}/secrets`, {
        method: "POST",
        body: JSON.stringify({ key, value: value.trim() }),
      });
      clear();
      await load();
      setStatus({ kind: "ok", text: `${key} saved` });
    } catch (err) {
      setStatus({ kind: "err", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function testKey(key: "CURSOR_API_KEY" | "ANTHROPIC_API_KEY") {
    setTesting(key);
    setStatus(null);
    try {
      const result = await api<{
        ok: true;
        provider: string;
        login: string;
        modelCount?: number;
      }>(`/api/projects/${projectId}/secrets/test`, {
        method: "POST",
        body: JSON.stringify({ key }),
      });
      const models =
        result.modelCount != null ? `, ${result.modelCount} models available` : "";
      setStatus({
        kind: "ok",
        text: `${key}: connected as ${result.login}${models}`,
      });
    } catch (err) {
      setStatus({
        kind: "err",
        text: `${key}: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setTesting(null);
    }
  }

  return (
    <div className="stack">
      <h1>Settings</h1>
      <div className="card stack">
        <h3>Factory defaults</h3>
        <p className="muted">
          Instance-wide wait-for-review defaults. Projects inherit these unless an agent is set to
          Always / Never on the Agents page.
        </p>
        {defaults.map((row) => (
          <label className="toggle" key={row.agentName}>
            <input
              type="checkbox"
              checked={row.waitForReview}
              disabled={busy}
              onChange={(e) => {
                const next = defaults.map((d) =>
                  d.agentName === row.agentName
                    ? { ...d, waitForReview: e.target.checked }
                    : d,
                );
                setDefaults(next);
              }}
            />
            <span>
              <strong>{row.agentName}</strong> wait for review after run
            </span>
          </label>
        ))}
        <div className="row">
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => void saveDefaults(defaults)}
          >
            Save defaults
          </button>
        </div>
      </div>
      <div className="card stack">
        <h3>API keys</h3>
        <p className="muted">
          Stored encrypted. Env vars also work as fallback. Create a Cursor API key at{" "}
          <a href="https://grok.com/dashboard/api-keys" target="_blank" rel="noreferrer">
            grok.com/dashboard/api-keys
          </a>{" "}
          → Create API key (type Cursor, prefix <code>crsr_</code>).
        </p>

        {status && (
          <div
            className="card"
            style={{
              borderColor: status.kind === "err" ? "var(--danger)" : "var(--ok)",
              color: status.kind === "err" ? "var(--danger)" : "var(--ok)",
            }}
          >
            {status.text}
          </div>
        )}

        <div className="stack" style={{ gap: "0.45rem" }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="muted">
              {cursor ? "Replace Cursor API key" : "Add Cursor API key"}
            </span>
            <div className="row" style={{ gap: "0.5rem" }}>
              <StatusBadge present={Boolean(cursor)} />
              {cursor?.createdAt && (
                <span className="muted" style={{ fontSize: "0.8rem" }}>
                  Saved {new Date(cursor.createdAt).toLocaleString()}
                </span>
              )}
            </div>
          </div>
          <input
            type="password"
            placeholder="crsr_... or cursor_..."
            value={cursorKey}
            onChange={(e) => setCursorKey(e.target.value)}
          />
          <div className="row">
            <button
              type="button"
              className="primary"
              disabled={busy || testing !== null}
              onClick={() => void save("CURSOR_API_KEY", cursorKey, () => setCursorKey(""))}
            >
              {cursor ? "Update Cursor key" : "Save Cursor key"}
            </button>
            <button
              type="button"
              disabled={!cursor || busy || testing !== null}
              onClick={() => void testKey("CURSOR_API_KEY")}
            >
              {testing === "CURSOR_API_KEY" ? "Testing…" : "Test"}
            </button>
          </div>
        </div>

        <div className="stack" style={{ gap: "0.45rem" }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="muted">
              {anthropic ? "Replace Anthropic API key" : "Add Anthropic API key"} — create at{" "}
              <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
                console.anthropic.com/settings/keys
              </a>
              . Only for claude-code agents.
            </span>
            <div className="row" style={{ gap: "0.5rem" }}>
              <StatusBadge present={Boolean(anthropic)} />
              {anthropic?.createdAt && (
                <span className="muted" style={{ fontSize: "0.8rem" }}>
                  Saved {new Date(anthropic.createdAt).toLocaleString()}
                </span>
              )}
            </div>
          </div>
          <input
            type="password"
            placeholder="sk-ant-..."
            value={anthropicKey}
            onChange={(e) => setAnthropicKey(e.target.value)}
          />
          <div className="row">
            <button
              type="button"
              disabled={busy || testing !== null}
              onClick={() =>
                void save("ANTHROPIC_API_KEY", anthropicKey, () => setAnthropicKey(""))
              }
            >
              {anthropic ? "Update Anthropic key" : "Save Anthropic key"}
            </button>
            <button
              type="button"
              disabled={!anthropic || busy || testing !== null}
              onClick={() => void testKey("ANTHROPIC_API_KEY")}
            >
              {testing === "ANTHROPIC_API_KEY" ? "Testing…" : "Test"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
