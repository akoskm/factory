import { useEffect, useState } from "react";
import { api } from "../api";
import { useProjectId } from "../App";

export function SettingsPage() {
  const projectId = useProjectId();
  const [keys, setKeys] = useState<{ id: string; key: string }[]>([]);
  const [cursorKey, setCursorKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");

  async function load() {
    setKeys(await api(`/api/projects/${projectId}/secrets`));
  }

  useEffect(() => {
    void load();
  }, [projectId]);

  return (
    <div className="stack">
      <h1>Settings</h1>
      <div className="card stack">
        <h3>API keys</h3>
        <p className="muted">Stored encrypted. Env vars also work as fallback.</p>
        <input
          type="password"
          placeholder="CURSOR_API_KEY"
          value={cursorKey}
          onChange={(e) => setCursorKey(e.target.value)}
        />
        <button
          onClick={async () => {
            await api(`/api/projects/${projectId}/secrets`, {
              method: "POST",
              body: JSON.stringify({ key: "CURSOR_API_KEY", value: cursorKey }),
            });
            setCursorKey("");
            await load();
          }}
        >
          Save Cursor key
        </button>
        <input
          type="password"
          placeholder="ANTHROPIC_API_KEY"
          value={anthropicKey}
          onChange={(e) => setAnthropicKey(e.target.value)}
        />
        <button
          onClick={async () => {
            await api(`/api/projects/${projectId}/secrets`, {
              method: "POST",
              body: JSON.stringify({ key: "ANTHROPIC_API_KEY", value: anthropicKey }),
            });
            setAnthropicKey("");
            await load();
          }}
        >
          Save Anthropic key
        </button>
        <div className="muted">
          Stored: {keys.map((k) => k.key).join(", ") || "none"}
        </div>
      </div>
    </div>
  );
}
