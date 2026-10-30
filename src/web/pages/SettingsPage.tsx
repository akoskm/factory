import { useEffect, useState } from "react";
import { api, type AgentDefault } from "../api";
import { useProjectId } from "../use-project-id";
import { PageHeader } from "@/components/page-header";
import { StatusAlert } from "@/components/status-alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type SecretRow = { id: string; key: string; createdAt: string };

function StatusBadge({ present }: { present: boolean }) {
  return <Badge variant={present ? "secondary" : "destructive"}>{present ? "Set" : "Not set"}</Badge>;
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
      const models = result.modelCount != null ? `, ${result.modelCount} models available` : "";
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
    <div className="space-y-6">
      <PageHeader title="Settings" />
      {status && <StatusAlert kind={status.kind} text={status.text} />}
      <Card>
        <CardHeader>
          <CardTitle>Factory defaults</CardTitle>
          <CardDescription>
            Instance-wide wait-for-review defaults. Projects inherit these unless an agent is set
            to Always / Never on the Agents page.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {defaults.map((row) => (
            <div key={row.agentName} className="flex items-center gap-3">
              <Switch
                id={`default-${row.agentName}`}
                checked={row.waitForReview}
                disabled={busy}
                onCheckedChange={(checked) => {
                  setDefaults(
                    defaults.map((d) =>
                      d.agentName === row.agentName ? { ...d, waitForReview: checked } : d,
                    ),
                  );
                }}
              />
              <Label htmlFor={`default-${row.agentName}`}>
                <span className="font-medium">{row.agentName}</span> wait for review after run
              </Label>
            </div>
          ))}
          <div>
            <Button disabled={busy} onClick={() => void saveDefaults(defaults)}>
              Save defaults
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>API keys</CardTitle>
          <CardDescription>
            Stored encrypted. Env vars also work as fallback. Create a Cursor API key at{" "}
            <a
              href="https://grok.com/dashboard/api-keys"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4"
            >
              grok.com/dashboard/api-keys
            </a>{" "}
            → Create API key (type Cursor, prefix <code className="font-mono text-xs">crsr_</code>
            ).
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground">
                {cursor ? "Replace Cursor API key" : "Add Cursor API key"}
              </span>
              <div className="flex items-center gap-2">
                <StatusBadge present={Boolean(cursor)} />
                {cursor?.createdAt && (
                  <span className="text-xs text-muted-foreground">
                    Saved {new Date(cursor.createdAt).toLocaleString()}
                  </span>
                )}
              </div>
            </div>
            <Input
              type="password"
              placeholder="crsr_... or cursor_..."
              value={cursorKey}
              onChange={(e) => setCursorKey(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy || testing !== null}
                onClick={() => void save("CURSOR_API_KEY", cursorKey, () => setCursorKey(""))}
              >
                {cursor ? "Update Cursor key" : "Save Cursor key"}
              </Button>
              <Button
                variant="outline"
                disabled={!cursor || busy || testing !== null}
                onClick={() => void testKey("CURSOR_API_KEY")}
              >
                {testing === "CURSOR_API_KEY" ? "Testing…" : "Test"}
              </Button>
            </div>
          </div>
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground">
                {anthropic ? "Replace Anthropic API key" : "Add Anthropic API key"} — create at{" "}
                <a
                  href="https://console.anthropic.com/settings/keys"
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-4"
                >
                  console.anthropic.com/settings/keys
                </a>
                . Only for claude-code agents.
              </span>
              <div className="flex items-center gap-2">
                <StatusBadge present={Boolean(anthropic)} />
                {anthropic?.createdAt && (
                  <span className="text-xs text-muted-foreground">
                    Saved {new Date(anthropic.createdAt).toLocaleString()}
                  </span>
                )}
              </div>
            </div>
            <Input
              type="password"
              placeholder="sk-ant-..."
              value={anthropicKey}
              onChange={(e) => setAnthropicKey(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={busy || testing !== null}
                onClick={() =>
                  void save("ANTHROPIC_API_KEY", anthropicKey, () => setAnthropicKey(""))
                }
              >
                {anthropic ? "Update Anthropic key" : "Save Anthropic key"}
              </Button>
              <Button
                variant="outline"
                disabled={!anthropic || busy || testing !== null}
                onClick={() => void testKey("ANTHROPIC_API_KEY")}
              >
                {testing === "ANTHROPIC_API_KEY" ? "Testing…" : "Test"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
