import { useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { api, type Project } from "./api";
import { AgentsPage } from "./pages/AgentsPage";
import { DashboardPage } from "./pages/DashboardPage";
import { RunsPage } from "./pages/RunsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SourcesPage } from "./pages/SourcesPage";
import { SuggestionsPage } from "./pages/SuggestionsPage";
import { WorkItemPage } from "./pages/WorkItemPage";
import { WorkPage } from "./pages/WorkPage";

function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  return (
    <div className="login stack">
      <h1>Factory</h1>
      <p className="muted">Enter admin password</p>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void submit();
        }}
      />
      {error && <div style={{ color: "var(--danger)" }}>{error}</div>}
      <button className="primary" onClick={() => void submit()}>
        Sign in
      </button>
    </div>
  );

  async function submit() {
    try {
      await api("/api/login", { method: "POST", body: JSON.stringify({ password }) });
      onDone();
    } catch {
      setError("Invalid password");
    }
  }
}

function Shell({ projects, refresh }: { projects: Project[]; refresh: () => void }) {
  const loc = useLocation();
  const projectId = loc.pathname.match(/^\/p\/([^/]+)/)?.[1];
  const project = projects.find((p) => p.id === projectId) ?? projects[0];

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">FACTORY</div>
        <select
          value={project?.id ?? ""}
          onChange={(e) => {
            if (e.target.value) window.location.href = `/p/${e.target.value}`;
          }}
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {project && (
          <nav className="nav stack">
            <Nav to={`/p/${project.id}`} end>
              Productivity
            </Nav>
            <Nav to={`/p/${project.id}/work`}>Work</Nav>
            <Nav to={`/p/${project.id}/runs`}>Runs</Nav>
            <Nav to={`/p/${project.id}/agents`}>Agents</Nav>
            <Nav to={`/p/${project.id}/sources`}>Sources</Nav>
            <Nav to={`/p/${project.id}/suggestions`}>Suggestions</Nav>
            <Nav to={`/p/${project.id}/settings`}>Settings</Nav>
          </nav>
        )}
        <div style={{ flex: 1 }} />
        <NewProject onCreated={refresh} />
      </aside>
      <main className="main">
        <Routes>
          <Route path="/" element={project ? <Navigate to={`/p/${project.id}`} /> : <Empty />} />
          <Route path="/p/:projectId" element={<DashboardPage />} />
          <Route path="/p/:projectId/work" element={<WorkPage />} />
          <Route path="/p/:projectId/work/:workItemId" element={<WorkItemPage />} />
          <Route path="/p/:projectId/runs" element={<RunsPage />} />
          <Route path="/p/:projectId/agents" element={<AgentsPage />} />
          <Route path="/p/:projectId/sources" element={<SourcesPage />} />
          <Route path="/p/:projectId/suggestions" element={<SuggestionsPage />} />
          <Route path="/p/:projectId/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}

function Nav({ to, children, end }: { to: string; children: React.ReactNode; end?: boolean }) {
  const loc = useLocation();
  const active = end ? loc.pathname === to : loc.pathname.startsWith(to);
  return (
    <Link className={active ? "active" : ""} to={to}>
      {children}
    </Link>
  );
}

function Empty() {
  return <p className="muted">Create a project to start.</p>;
}

function NewProject({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  if (!open) {
    return (
      <button className="ghost" onClick={() => setOpen(true)}>
        + New project
      </button>
    );
  }
  return (
    <div className="stack">
      <input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
      <input placeholder="Repo URL" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} />
      <button
        className="primary"
        onClick={async () => {
          const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
          await api("/api/projects", {
            method: "POST",
            body: JSON.stringify({ name, slug, repoUrl }),
          });
          setOpen(false);
          onCreated();
        }}
      >
        Create
      </button>
    </div>
  );
}

export function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);

  async function load() {
    const me = await api<{ authenticated: boolean }>("/api/me");
    setAuthed(me.authenticated);
    if (me.authenticated) {
      setProjects(await api<Project[]>("/api/projects"));
    }
  }

  useEffect(() => {
    void load();
  }, []);

  if (authed === null) return <div className="main">Loading…</div>;
  if (!authed) return <Login onDone={() => void load()} />;
  return <Shell projects={projects} refresh={() => void load()} />;
}

export function useProjectId() {
  return useParams().projectId!;
}
