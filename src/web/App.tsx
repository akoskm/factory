import { useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  Bot,
  ChartColumn,
  Factory,
  FolderGit2,
  Lightbulb,
  ListTodo,
  Plus,
  Settings,
} from "lucide-react";
import { api, type Project } from "./api";
import { AgentsPage } from "./pages/AgentsPage";
import { DashboardPage } from "./pages/DashboardPage";
import { RunsPage } from "./pages/RunsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SourcesPage } from "./pages/SourcesPage";
import { SuggestionsPage } from "./pages/SuggestionsPage";
import { WorkItemPage } from "./pages/WorkItemPage";
import { WorkPage } from "./pages/WorkPage";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const NAV = [
  { label: "Productivity", icon: ChartColumn, path: "", end: true },
  { label: "Work", icon: ListTodo, path: "/work" },
  { label: "Runs", icon: Activity, path: "/runs" },
  { label: "Agents", icon: Bot, path: "/agents" },
  { label: "Sources", icon: FolderGit2, path: "/sources" },
  { label: "Suggestions", icon: Lightbulb, path: "/suggestions" },
  { label: "Settings", icon: Settings, path: "/settings" },
] as const;

function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit() {
    try {
      await api("/api/login", { method: "POST", body: JSON.stringify({ password }) });
      onDone();
    } catch {
      setError("Invalid password");
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Factory className="size-4" />
            Factory
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <p className="text-sm text-muted-foreground">Enter admin password</p>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button onClick={() => void submit()}>Sign in</Button>
        </CardContent>
      </Card>
    </div>
  );
}

function Shell({ projects, refresh }: { projects: Project[]; refresh: () => void }) {
  const loc = useLocation();
  const navigate = useNavigate();
  const projectId = loc.pathname.match(/^\/p\/([^/]+)/)?.[1];
  const project = projects.find((p) => p.id === projectId) ?? projects[0];

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" className="pointer-events-none">
                <Factory />
                <span className="font-semibold tracking-wide">FACTORY</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          {project && (
            <div className="group-data-[collapsible=icon]:hidden">
              <Select value={project.id} onValueChange={(id) => navigate(`/p/${id}`)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </SidebarHeader>
        {project && (
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  {NAV.map((item) => {
                    const to = `/p/${project.id}${item.path}`;
                    const active =
                      "end" in item && item.end
                        ? loc.pathname === to
                        : loc.pathname.startsWith(to);
                    const Icon = item.icon;
                    return (
                      <SidebarMenuItem key={item.label}>
                        <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                          <Link to={to}>
                            <Icon />
                            <span>{item.label}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        )}
        <SidebarFooter>
          <NewProject onCreated={refresh} />
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="min-w-0">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          {project && (
            <span className="truncate text-sm text-muted-foreground">{project.name}</span>
          )}
        </header>
        <div className="flex min-w-0 flex-1 flex-col gap-6 p-4 md:p-6 [&>*]:min-w-0">
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
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function Empty() {
  return <p className="text-sm text-muted-foreground">Create a project to start.</p>;
}

function NewProject({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    setError("");
    try {
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      await api("/api/projects", {
        method: "POST",
        body: JSON.stringify({ name, slug, repoUrl }),
      });
      setOpen(false);
      setName("");
      setRepoUrl("");
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        variant="outline"
        className="w-full group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:p-0"
        onClick={() => setOpen(true)}
      >
        <Plus />
        <span className="group-data-[collapsible=icon]:hidden">New project</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="project-name">Name</Label>
              <Input
                id="project-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="project-repo">Repo URL</Label>
              <Input
                id="project-repo"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button disabled={busy || !name.trim()} onClick={() => void create()}>
              {busy ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [bootError, setBootError] = useState<string | null>(null);

  async function load() {
    setBootError(null);
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const me = await api<{ authenticated: boolean }>("/api/me");
        if (!me.authenticated) {
          setAuthed(false);
          return;
        }
        setProjects(await api<Project[]>("/api/projects"));
        setAuthed(true);
        return;
      } catch (err) {
        lastError = err;
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    }
    setBootError(lastError instanceof Error ? lastError.message : String(lastError));
  }

  useEffect(() => {
    void load();
  }, []);

  if (authed === null) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        {bootError ? (
          <>
            <p>Could not reach the factory. {bootError}</p>
            <Button variant="outline" onClick={() => void load()}>
              Retry
            </Button>
          </>
        ) : (
          <p>Loading…</p>
        )}
      </div>
    );
  }
  if (!authed) return <Login onDone={() => void load()} />;
  return <Shell projects={projects} refresh={() => void load()} />;
}
