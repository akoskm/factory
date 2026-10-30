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

type FormState = {
  name: string;
  owner: string;
  repo: string;
  label: string;
  token: string;
};

const emptyForm = (): FormState => ({
  name: "GitHub",
  owner: "",
  repo: "",
  label: "factory",
  token: "",
});

export function SourcesPage() {
  const projectId = useProjectId();
  const [sources, setSources] = useState<Source[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [status, setStatus] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setSources(await api<Source[]>(`/api/projects/${projectId}/sources`));
  }

  useEffect(() => {
    void load().catch((err) => {
      setStatus({ kind: "err", text: err instanceof Error ? err.message : String(err) });
    });
  }, [projectId]);

  function startEdit(source: Source) {
    setEditingId(source.id);
    setStatus(null);
    setForm({
      name: source.name,
      owner: source.config.owner,
      repo: source.config.repo,
      label: source.config.label,
      token: "",
    });
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  }

  function resetForm() {
    setEditingId(null);
    setForm(emptyForm());
  }

  async function save() {
    setStatus(null);
    if (!form.owner.trim() || !form.repo.trim()) {
      setStatus({ kind: "err", text: "owner and repo are required" });
      return;
    }
    if (!editingId && !form.token.trim()) {
      setStatus({ kind: "err", text: "token is required" });
      return;
    }

    setBusy(true);
    try {
      if (editingId) {
        const body: Record<string, string> = {
          name: form.name,
          owner: form.owner,
          repo: form.repo,
          label: form.label,
        };
        if (form.token.trim()) body.token = form.token.trim();
        await api(`/api/sources/${editingId}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        setStatus({ kind: "ok", text: `Saved ${form.owner}/${form.repo}` });
      } else {
        await api(`/api/projects/${projectId}/sources`, {
          method: "POST",
          body: JSON.stringify(form),
        });
        setStatus({ kind: "ok", text: `Added ${form.owner}/${form.repo}` });
      }
      resetForm();
      await load();
    } catch (err) {
      setStatus({ kind: "err", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function remove(source: Source) {
    const target = `${source.config.owner}/${source.config.repo}`;
    if (!confirm(`Delete source ${target}?`)) return;
    setStatus(null);
    setBusy(true);
    try {
      await api(`/api/sources/${source.id}`, { method: "DELETE" });
      if (editingId === source.id) resetForm();
      setStatus({ kind: "ok", text: `Deleted ${target}` });
      await load();
    } catch (err) {
      setStatus({ kind: "err", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function testConnection(source: Source) {
    const target = `${source.config.owner}/${source.config.repo}`;
    setStatus(null);
    setBusy(true);
    try {
      const result = await api<{
        ok: true;
        login: string;
        repo: string;
        openLabeledIssues: number;
        label: string;
        permissions?: { push?: boolean; pull?: boolean; admin?: boolean };
      }>(`/api/sources/${source.id}/test`, { method: "POST" });
      const push = result.permissions?.push ? "push ok" : "no push";
      setStatus({
        kind: "ok",
        text: `Connected as ${result.login} → ${result.repo} (${push}, ${result.openLabeledIssues} open issues with label "${result.label}")`,
      });
    } catch (err) {
      setStatus({
        kind: "err",
        text: `${target}: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <h1>Sources</h1>
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
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Kind</th>
            <th>Target</th>
            <th>Label</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {sources.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                No sources yet
              </td>
            </tr>
          )}
          {sources.map((s) => (
            <tr key={s.id}>
              <td>{s.name}</td>
              <td>{s.kind}</td>
              <td>
                {s.config.owner || "?"}/{s.config.repo || "?"}
              </td>
              <td>{s.config.label}</td>
              <td>
                <div className="row">
                  <button type="button" disabled={busy} onClick={() => void testConnection(s)}>
                    Test
                  </button>
                  <button type="button" disabled={busy} onClick={() => startEdit(s)}>
                    Edit
                  </button>
                  <button type="button" disabled={busy} onClick={() => void remove(s)}>
                    Delete
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="card stack">
        <h3>{editingId ? "Edit source" : "Add GitHub source"}</h3>
        {editingId && (
          <p className="muted">Editing existing source. Paste a new token only if you want to replace it.</p>
        )}
        <label className="stack" style={{ gap: "0.25rem" }}>
          <span className="muted">Name</span>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>
        <label className="stack" style={{ gap: "0.25rem" }}>
          <span className="muted">Owner</span>
          <input
            placeholder="akoskm"
            value={form.owner}
            onChange={(e) => setForm({ ...form, owner: e.target.value })}
          />
        </label>
        <label className="stack" style={{ gap: "0.25rem" }}>
          <span className="muted">Repo</span>
          <input
            placeholder="factory"
            value={form.repo}
            onChange={(e) => setForm({ ...form, repo: e.target.value })}
          />
        </label>
        <label className="stack" style={{ gap: "0.25rem" }}>
          <span className="muted">Label</span>
          <input
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
          />
        </label>
        <label className="stack" style={{ gap: "0.25rem" }}>
          <span className="muted">
            GitHub token{editingId ? " (optional — leave blank to keep current)" : ""}
          </span>
          <input
            type="password"
            placeholder={editingId ? "leave blank to keep" : "github_pat_..."}
            value={form.token}
            onChange={(e) => setForm({ ...form, token: e.target.value })}
          />
        </label>
        <div className="row">
          <button type="button" className="primary" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save"}
          </button>
          {editingId && (
            <button type="button" disabled={busy} onClick={resetForm}>
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
