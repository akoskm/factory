import { useEffect, useState } from "react";
import { ChevronDown, Save } from "lucide-react";
import { agentTypeByName } from "../agent-mark";
import { api, type ConfigAgent, type ConfigAgentsResponse } from "../api";
import { onCompleteCatalog, type CatalogRow } from "../on-complete-catalog";
import { useProjectId } from "../use-project-id";
import { AgentChip } from "@/components/agent-chip";
import { PageHeader } from "@/components/page-header";
import { PipelineFlow } from "@/components/pipeline-flow";
import { PreBlock } from "@/components/pre-block";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function AgentsPage() {
  const projectId = useProjectId();
  const [data, setData] = useState<ConfigAgentsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [defaultHarness, setDefaultHarness] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    void api<ConfigAgentsResponse>(`/api/projects/${projectId}/agents`)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [projectId]);

  useEffect(() => {
    void api<{ harness: string | null; model: string | null }>(
      `/api/projects/${projectId}/settings/agent-defaults`,
    )
      .then((d) => {
        setDefaultHarness(d.harness || "");
        setDefaultModel(d.model || "");
      })
      .catch(() => {});
  }, [projectId]);

  const hub = data?.pipeline.routes.default || data?.pipeline.startAgent;

  async function applyDefaults() {
    setSaving(true);
    setSaved(null);
    try {
      await api(`/api/projects/${projectId}/settings/agent-defaults`, {
        method: "PATCH",
        body: JSON.stringify({
          harness: defaultHarness || null,
          model: defaultModel.trim() || null,
        }),
      });
      setSaved("Saved. New runs use these settings.");
      // Reload agents with overrides applied
      const fresh = await api<ConfigAgentsResponse>(`/api/projects/${projectId}/agents`);
      setData(fresh);
      setTimeout(() => setSaved(null), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to apply defaults");
    } finally {
      setSaving(false);
    }
  }

  async function clearDefaults() {
    try {
      await api(`/api/projects/${projectId}/settings/agent-defaults`, {
        method: "PATCH",
        body: JSON.stringify({ harness: null, model: null }),
      });
      setDefaultHarness("");
      setDefaultModel("");
      const fresh = await api<ConfigAgentsResponse>(`/api/projects/${projectId}/agents`);
      setData(fresh);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to clear defaults");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agents"
        description="Loaded from factory-config. Edit opens that file on GitHub."
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      {saved && (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800">
          {saved}
        </div>
      )}
      {data && (
        <section className="space-y-3">
          <div className="space-y-1">
            <h2 className="font-heading text-lg font-semibold tracking-tight">Pipeline</h2>
            <p className="font-mono text-sm text-muted-foreground">
              <ConfigRepoLabel repo={data.configRepo} sha={data.configSha} />
            </p>
            <p className="text-sm text-muted-foreground">
              {hub} spawns the workspace agents, and those agents return to {hub} on the default route. Extra edges are the other routes and the onComplete list, in order.
            </p>
          </div>
          <PipelineFlow pipeline={data.pipeline} agentTypes={agentTypeByName(data.agents)} />
          <Card size="sm">
            <CardHeader className="border-b">
              <CardTitle>After merge</CardTitle>
              <CardDescription>onComplete runs in this order.</CardDescription>
              <CardAction>
                <EditOnGitHub href={data.pipelineEditUrl} />
              </CardAction>
            </CardHeader>
            <CardContent className="grid gap-4">
              <OnCompleteCatalog
                pipeline={data.pipeline.onComplete}
                agents={data.agents}
                editUrl={data.pipelineEditUrl}
              />
            </CardContent>
            <Collapsible defaultOpen>
              <CollapsibleTrigger className="group flex w-full items-center gap-2 border-t px-4 py-3 text-left">
                <span className="font-mono text-sm">pipeline.yaml</span>
                <ChevronDown className="ml-auto size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="border-t pt-3 pb-4">
                  <PreBlock>{data.pipelineYaml}</PreBlock>
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>
        </section>
      )}
      {data && (
        <GlobalAgentDefaultsCard
          appliedOverrides={data.appliedAgentOverrides}
          defaultHarness={defaultHarness}
          setDefaultHarness={setDefaultHarness}
          defaultModel={defaultModel}
          setDefaultModel={setDefaultModel}
          onSave={applyDefaults}
          onClear={clearDefaults}
          saving={saving}
        />
      )}
      {data && (
        <section className="space-y-3">
          <h2 className="font-heading text-lg font-semibold tracking-tight">Agents</h2>
          {data.agents.map((agent) => (
            <AgentCard key={agent.name} agent={agent} />
          ))}
        </section>
      )}
    </div>
  );
}

function GlobalAgentDefaultsCard({
  appliedOverrides,
  defaultHarness,
  setDefaultHarness,
  defaultModel,
  setDefaultModel,
  onSave,
  onClear,
  saving,
}: {
  appliedOverrides: { harness: string | null; model: string | null };
  defaultHarness: string;
  setDefaultHarness: (v: string) => void;
  defaultModel: string;
  setDefaultModel: (v: string) => void;
  onSave: () => Promise<void>;
  onClear: () => void;
  saving: boolean;
}) {
  const harnesses = ["cursor", "claude-code", "local"];
  const active = Boolean(appliedOverrides.harness || appliedOverrides.model);

  return (
    <Card size="sm" className={active ? "border-amber-300" : ""}>
      <CardHeader className="border-b pb-3">
        <div className="flex items-center gap-2">
          <CardTitle>Run defaults</CardTitle>
          {active && <Badge variant="secondary">Active</Badge>}
        </div>
        <CardDescription>
          Optional. New runs use this harness and model instead of each agent.md. The list below stays the file values.
        </CardDescription>
        <CardAction>
          {active && (
            <Button variant="outline" size="xs" onClick={onClear}>
              Clear
            </Button>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-4 pt-4">
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label className="text-xs">Harness</Label>
            <Select value={defaultHarness} onValueChange={setDefaultHarness}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Use agent.md" />
              </SelectTrigger>
              <SelectContent>
                {harnesses.map((harness) => (
                  <SelectItem key={harness} value={harness}>
                    {harness}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs" htmlFor="default-model">
              Model
            </Label>
            <Input
              id="default-model"
              autoComplete="off"
              placeholder="Qwen3.6-35B-A3B-UD-Q4_K_M"
              value={defaultModel}
              onChange={(event) => setDefaultModel(event.target.value)}
            />
          </div>
        </div>
        <Button size="sm" onClick={onSave} disabled={saving}>
          <Save className="mr-2 size-3.5" />
          {saving ? "Saving…" : "Save run defaults"}
        </Button>
        {active && (
          <p className="text-xs text-muted-foreground">
            Runs use <code className="font-mono">{appliedOverrides.harness || "each agent.md harness"}</code>
            {" · "}
            <code className="font-mono">{appliedOverrides.model || "each agent.md model"}</code>
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function OnCompleteCatalog({
  pipeline,
  agents,
  editUrl,
}: {
  pipeline: string[];
  agents: ConfigAgent[];
  editUrl: string | null;
}) {
  const { current, missing } = onCompleteCatalog(pipeline, agents);
  return (
    <>
      <StepGroup title="This pipeline" rows={current} />
      {missing.length > 0 && <MissingSteps rows={missing} editUrl={editUrl} />}
    </>
  );
}

function MissingSteps({ rows, editUrl }: { rows: CatalogRow[]; editUrl: string | null }) {
  return (
    <div className="grid gap-2">
      <div className="grid gap-0.5">
        <h3 className="text-sm font-medium">Not in this pipeline</h3>
        <p className="text-sm text-muted-foreground">Paste the step into onComplete, then commit.</p>
      </div>
      <ul className="grid gap-2">
        {rows.map((row) => (
          <li
            key={row.name}
            className="grid items-center gap-2 sm:grid-cols-[9rem_5.5rem_1fr_auto] sm:gap-3"
          >
            <span className="font-mono text-sm">{row.name}</span>
            <Badge variant="secondary">{row.kind}</Badge>
            <span className="text-sm text-muted-foreground">{row.summary}</span>
            <span className="flex items-center gap-2">
              <CopyStep name={row.name} />
              <EditOnGitHub href={editUrl} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CopyStep({ name }: { name: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="outline"
      size="xs"
      onClick={() => {
        void navigator.clipboard.writeText(`- ${name}`).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

function StepGroup({ title, rows }: { title: string; rows: CatalogRow[] }) {
  return (
    <div className="grid gap-2">
      <h3 className="text-sm font-medium">{title}</h3>
      <ul className="grid gap-2">
        {rows.map((row) => (
          <li
            key={row.name}
            className="grid items-baseline gap-1 sm:grid-cols-[9rem_5.5rem_1fr] sm:gap-3"
          >
            <span className="font-mono text-sm">{row.name}</span>
            <Badge variant={row.kind === "Built-in" ? "secondary" : "outline"}>{row.kind}</Badge>
            <span className="text-sm text-muted-foreground">{row.summary}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function configRepoHref(repo: string, sha: string): string | null {
  const match = repo.trim().match(/github\.com[/:]([^/]+)\/([^/.]+?)(?:\.git)?$/i);
  if (match && sha) return `https://github.com/${match[1]}/${match[2]}/tree/${sha}`;
  if (/^https?:\/\//i.test(repo.trim())) return repo.trim().replace(/\.git$/, "");
  return null;
}

function ConfigRepoLabel({ repo, sha }: { repo: string; sha: string }) {
  const label = `${repo} @ ${sha.slice(0, 12)}`;
  const href = configRepoHref(repo, sha);
  if (!href) return label;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="underline-offset-4 hover:text-foreground hover:underline"
    >
      {label}
    </a>
  );
}

function EditOnGitHub({ href }: { href: string | null }) {
  if (!href) return null;
  return (
    <Button variant="outline" size="xs" asChild>
      <a href={href} target="_blank" rel="noreferrer">
        Edit
      </a>
    </Button>
  );
}

function AgentCard({ agent }: { agent: ConfigAgent }) {
  return (
    <Collapsible>
      <Card size="sm" className="py-0">
        <div className="flex items-center pr-3">
          <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-2 px-4 py-3 text-left">
            <AgentChip agentType={agent.agentType} />
            <CardTitle>{agent.name}</CardTitle>
            <Badge variant="secondary">{agent.agentType}</Badge>
            <Badge variant="outline">{agent.harness}</Badge>
            <Badge variant="outline">{agent.model}</Badge>
            <Badge variant="outline">wait: {agent.waitForReview ? "yes" : "no"}</Badge>
            <ChevronDown className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
          </CollapsibleTrigger>
          <EditOnGitHub href={agent.editUrl} />
        </div>
        <CollapsibleContent>
          <CardContent className="grid gap-3 border-t pt-3 pb-4">
            <p className="text-sm text-muted-foreground">{agent.description}</p>
            <dl className="grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
              <div>Spawned by {agent.spawnableBy.join(", ") || "—"}</div>
              <div>Idle timeout {agent.idleTimeoutMinutes} min</div>
            </dl>
            <PreBlock>{agent.instructions}</PreBlock>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
