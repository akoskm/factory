import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "../api";
import { useProjectId } from "../use-project-id";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type SecretRow = { id: string; key: string; createdAt: string };

type FactoryConfigSetting = {
  repoUrl: string | null;
  source: "settings" | "env" | null;
  configSha?: string;
  agentCount?: number;
  error?: string;
};

function StatusBadge({ present }: { present: boolean }) {
  return <Badge variant={present ? "secondary" : "destructive"}>{present ? "Set" : "Not set"}</Badge>;
}

export function SettingsPage() {
  const projectId = useProjectId();
  const [keys, setKeys] = useState<SecretRow[]>([]);
  const [configRepo, setConfigRepo] = useState("");
  const [configMeta, setConfigMeta] = useState<FactoryConfigSetting | null>(null);
  const [cursorKey, setCursorKey] = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [localApiKey, setLocalApiKey] = useState("");
  const [localBaseUrl, setLocalBaseUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);

  async function load() {
    const [secretRows, factoryConfig, localBase] = await Promise.all([
      api<SecretRow[]>(`/api/projects/${projectId}/secrets`),
      api<FactoryConfigSetting>("/api/settings/factory-config"),
      api<{ url: string | null }>(`/api/projects/${projectId}/settings/local-base-url`),
    ]);
    setKeys(secretRows);
    setConfigMeta(factoryConfig);
    setConfigRepo(factoryConfig.repoUrl ?? "");
    setLocalBaseUrl(localBase.url ?? "");
  }

  useEffect(() => {
    void load().catch((err) => {
      toast.error(err instanceof Error ? err.message : String(err));
    });
  }, [projectId]);

  const cursor = keys.find((k) => k.key === "CURSOR_API_KEY");
  const anthropic = keys.find((k) => k.key === "ANTHROPIC_API_KEY");
  const localKey = keys.find((k) => k.key === "LOCAL_API_KEY");

  async function saveConfigRepo() {
    if (!configRepo.trim()) {
      toast.error("Factory config repo URL is empty");
      return;
    }
    setBusy(true);
    try {
      const result = await api<FactoryConfigSetting>("/api/settings/factory-config", {
        method: "PATCH",
        body: JSON.stringify({ repoUrl: configRepo.trim() }),
      });
      setConfigMeta(result);
      setConfigRepo(result.repoUrl ?? configRepo.trim());
      toast.success(
        result.configSha
          ? `Factory config saved (${result.agentCount ?? 0} agents @ ${result.configSha.slice(0, 12)})`
          : "Factory config saved",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function save(key: string, value: string, clear: () => void) {
    if (!value.trim()) {
      toast.error(`${key} is empty`);
      return;
    }
    setBusy(true);
    try {
      await api(`/api/projects/${projectId}/secrets`, {
        method: "POST",
        body: JSON.stringify({ key, value: value.trim() }),
      });
      clear();
      await load();
      toast.success(`${key} saved`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function testKey(
    key: "CURSOR_API_KEY" | "ANTHROPIC_API_KEY" | "LOCAL_API_KEY",
  ) {
    setTesting(key);
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
      toast.success(`${key}: connected as ${result.login}${models}`);
    } catch (err) {
      toast.error(`${key}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTesting(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" />
      <Card>
        <CardHeader>
          <CardTitle>Factory config</CardTitle>
          <CardDescription>
            Git repo with <code className="font-mono text-xs">pipeline.yaml</code> and{" "}
            <code className="font-mono text-xs">agents/*/agent.md</code>. Install-wide — not per
            project.{" "}
            <a
              href="https://github.com/akoskm/factory-config"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4"
            >
              akoskm/factory-config
            </a>
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <StatusBadge present={Boolean(configMeta?.repoUrl)} />
            {configMeta?.source && <Badge variant="outline">from {configMeta.source}</Badge>}
          </div>
          <Input
            placeholder="https://github.com/org/factory-config"
            value={configRepo}
            onChange={(e) => setConfigRepo(e.target.value)}
          />
          <div>
            <Button disabled={busy} onClick={() => void saveConfigRepo()}>
              Save factory config repo
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>API keys</CardTitle>
          <CardDescription>
            Stored encrypted. Env vars also work as fallback. Agent harness, model, and wait-for-review
            live in factory-config frontmatter.
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
                {anthropic ? "Replace Anthropic API key" : "Add Anthropic API key"} — only for
                claude-code agents.
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
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-muted-foreground">
                Local API key — for openai-compatible backends (llama.cpp, etc.)
              </span>
              <div className="flex items-center gap-2">
                <StatusBadge present={Boolean(localKey)} />
                {localKey?.createdAt && (
                  <span className="text-xs text-muted-foreground">
                    Saved {new Date(localKey.createdAt).toLocaleString()}
                  </span>
                )}
              </div>
            </div>
            <Input
              type="password"
              placeholder="not-needed (llama.cpp)"
              value={localApiKey}
              onChange={(e) => setLocalApiKey(e.target.value)}
            />
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy || testing !== null}
                onClick={() =>
                  void save("LOCAL_API_KEY", localApiKey, () => setLocalApiKey(""))
                }
              >
                {localKey ? "Update local key" : "Save local key"}
              </Button>
              <Button
                variant="outline"
                disabled={!localKey || busy || testing !== null}
                onClick={() => void testKey("LOCAL_API_KEY")}
              >
                {testing === "LOCAL_API_KEY" ? "Testing…" : "Test"}
              </Button>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-xs text-muted-foreground">Base URL</label>
              <Input
                placeholder="http://127.0.0.1:18434/v1"
                value={localBaseUrl}
                onChange={(e) => setLocalBaseUrl(e.target.value)}
              />
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy || !localBaseUrl.trim()}
                  onClick={() => {
                    setBusy(true);
                    api(`/api/projects/${projectId}/settings/local-base-url`, {
                      method: "PATCH",
                      body: JSON.stringify({ url: localBaseUrl.trim() }),
                    })
                      .then(() => toast.success("Base URL saved"))
                      .catch((err) =>
                        toast.error(err instanceof Error ? err.message : "Failed to save"),
                      )
                      .finally(() => setBusy(false));
                  }}
                >
                  Save base URL
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!localBaseUrl.trim()}
                  onClick={() => {
                    setBusy(true);
                    api(`/api/projects/${projectId}/settings/local-base-url`, {
                      method: "PATCH",
                      body: JSON.stringify({ url: null }),
                    })
                      .then(() => {
                        setLocalBaseUrl("");
                        toast.success("Base URL cleared");
                      })
                      .catch((err) =>
                        toast.error(err instanceof Error ? err.message : "Failed to clear"),
                      )
                      .finally(() => setBusy(false));
                  }}
                >
                  Clear
                </Button>
              </div>
              <span className="text-[11px] text-muted-foreground">
                Stored in project settings. Persisted server-side.
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
