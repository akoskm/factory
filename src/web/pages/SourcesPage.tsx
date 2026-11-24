import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "../api";
import { useProjectId } from "../use-project-id";
import { Field } from "@/components/field";
import { PageHeader } from "@/components/page-header";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Source | null>(null);

  async function load() {
    setSources(await api<Source[]>(`/api/projects/${projectId}/sources`));
  }

  useEffect(() => {
    void load().catch((err) => {
      toast.error(err instanceof Error ? err.message : String(err));
    });
  }, [projectId]);

  function startEdit(source: Source) {
    setEditingId(source.id);
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
    if (!form.owner.trim() || !form.repo.trim()) {
      toast.error("owner and repo are required");
      return;
    }
    if (!editingId && !form.token.trim()) {
      toast.error("token is required");
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
        toast.success(`Saved ${form.owner}/${form.repo}`);
      } else {
        await api(`/api/projects/${projectId}/sources`, {
          method: "POST",
          body: JSON.stringify(form),
        });
        toast.success(`Added ${form.owner}/${form.repo}`);
      }
      resetForm();
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(source: Source) {
    const target = `${source.config.owner}/${source.config.repo}`;
    setBusy(true);
    try {
      await api(`/api/sources/${source.id}`, { method: "DELETE" });
      if (editingId === source.id) resetForm();
      toast.success(`Deleted ${target}`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setPendingDelete(null);
    }
  }

  async function testConnection(source: Source) {
    const target = `${source.config.owner}/${source.config.repo}`;
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
      toast.success(
        `Connected as ${result.login} → ${result.repo} (${push}, ${result.openLabeledIssues} open issues with label "${result.label}")`,
      );
    } catch (err) {
      toast.error(`${target}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Sources" />
      <Card className="min-w-0 py-0">
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[20%] pl-4">Name</TableHead>
              <TableHead className="w-[14%]">Kind</TableHead>
              <TableHead className="w-[24%]">Target</TableHead>
              <TableHead className="w-[14%]">Label</TableHead>
              <TableHead className="w-[28%] pr-4">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sources.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  No sources yet
                </TableCell>
              </TableRow>
            )}
            {sources.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="truncate pl-4">{s.name}</TableCell>
                <TableCell className="truncate">{s.kind}</TableCell>
                <TableCell className="truncate">
                  {s.config.owner || "?"}/{s.config.repo || "?"}
                </TableCell>
                <TableCell className="truncate">{s.config.label}</TableCell>
                <TableCell className="pr-4 whitespace-normal">
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => void testConnection(s)}
                    >
                      Test
                    </Button>
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => startEdit(s)}>
                      Edit
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={busy}
                      onClick={() => setPendingDelete(s)}
                    >
                      Delete
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{editingId ? "Edit source" : "Add GitHub source"}</CardTitle>
          {editingId && (
            <CardDescription>
              Editing existing source. Paste a new token only if you want to replace it.
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="grid gap-3">
          <Field label="Name">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Owner">
            <Input
              placeholder="akoskm"
              value={form.owner}
              onChange={(e) => setForm({ ...form, owner: e.target.value })}
            />
          </Field>
          <Field label="Repo">
            <Input
              placeholder="factory"
              value={form.repo}
              onChange={(e) => setForm({ ...form, repo: e.target.value })}
            />
          </Field>
          <Field label="Label">
            <Input
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
            />
          </Field>
          <Field
            label={
              editingId
                ? "GitHub token (optional — leave blank to keep current)"
                : "GitHub token"
            }
          >
            <Input
              type="password"
              placeholder={editingId ? "leave blank to keep" : "github_pat_..."}
              value={form.token}
              onChange={(e) => setForm({ ...form, token: e.target.value })}
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button disabled={busy} onClick={() => void save()}>
              {busy ? "Saving…" : "Save"}
            </Button>
            {editingId && (
              <Button variant="outline" disabled={busy} onClick={resetForm}>
                Cancel
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete source</AlertDialogTitle>
            <AlertDialogDescription>
              Delete {pendingDelete?.config.owner}/{pendingDelete?.config.repo}?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => pendingDelete && void remove(pendingDelete)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
