import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ExternalLink, Save } from "lucide-react";
import { useBlocker } from "react-router-dom";
import { agentTypeByName } from "../agent-mark";
import {
  api,
  type AgentConfigPrResponse,
  type AgentRunConfig,
  type ConfigAgent,
  type ConfigAgentsResponse,
  type HarnessModelsResponse,
} from "../api";
import { onCompleteCatalog, type CatalogRow } from "../on-complete-catalog";
import { useProjectId } from "../use-project-id";
import { AgentChip } from "@/components/agent-chip";
import { PageHeader } from "@/components/page-header";
import { PipelineFlow } from "@/components/pipeline-flow";
import { PreBlock } from "@/components/pre-block";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const HARNESSES = ["cursor", "claude-code", "local"] as const;

type DraftState = Record<string, AgentRunConfig>;

function agentsToDraft(agents: ConfigAgent[]): DraftState {
  return Object.fromEntries(agents.map((a) => [a.name, { harness: a.harness, model: a.model }]));
}

function draftDirty(baseline: DraftState, draft: DraftState): boolean {
  for (const name of Object.keys(baseline)) {
    const a = baseline[name];
    const b = draft[name];
    if (!b) return true;
    if (a.harness !== b.harness || a.model !== b.model) return true;
  }
  return false;
}

function changedAgents(baseline: DraftState, draft: DraftState): { name: string; harness: string; model: string }[] {
  const out: { name: string; harness: string; model: string }[] = [];
  for (const name of Object.keys(baseline)) {
    const a = baseline[name];
    const b = draft[name];
    if (!b || a.harness !== b.harness || a.model !== b.model) {
      out.push({ name, harness: b?.harness ?? a.harness, model: b?.model ?? a.model });
    }
  }
  return out;
}

function modelOptions(models: string[], current: string): string[] {
  if (!models.length) return current ? [current] : [];
  return models.includes(current) ? models : [current, ...models];
}

function pickModelOnHarnessChange(models: string[], current: string): string {
  if (models.includes(current)) return current;
  return models[0] ?? current;
}

export function AgentsPage() {
  const projectId = useProjectId();
  const [data, setData] = useState<ConfigAgentsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<DraftState>({});
  const [draft, setDraft] = useState<DraftState>({});
  const [defaultHarness, setDefaultHarness] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [savingDefaults, setSavingDefaults] = useState(false);
  const [defaultsSaved, setDefaultsSaved] = useState<string | null>(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configPr, setConfigPr] = useState<AgentConfigPrResponse | null>(null);

  const dirty = useMemo(() => draftDirty(baseline, draft), [baseline, draft]);
  const blocker = useBlocker(dirty);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    void api<ConfigAgentsResponse>(`/api/projects/${projectId}/agents`)
      .then((next) => {
        if (!cancel) {
          setData(next);
          const nextDraft = agentsToDraft(next.agents);
          setBaseline(nextDraft);
          setDraft(nextDraft);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancel) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
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
    setSavingDefaults(true);
    setDefaultsSaved(null);
    try {
      await api(`/api/projects/${projectId}/settings/agent-defaults`, {
        method: "PATCH",
        body: JSON.stringify({
          harness: defaultHarness || null,
          model: defaultModel.trim() || null,
        }),
      });
      setDefaultsSaved("Saved. New runs use these settings.");
      const fresh = await api<ConfigAgentsResponse>(`/api/projects/${projectId}/agents`);
      setData(fresh);
      setTimeout(() => setDefaultsSaved(null), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to apply defaults");
    } finally {
      setSavingDefaults(false);
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

  function updateAgent(name: string, patch: Partial<AgentRunConfig>) {
    setDraft((prev) => ({
      ...prev,
      [name]: { ...prev[name], ...patch },
    }));
    setConfigPr(null);
  }

  async function saveConfiguration() {
    setSavingConfig(true);
    setError(null);
    try {
      const agents = changedAgents(baseline, draft);
      const result = await api<AgentConfigPrResponse>(`/api/projects/${projectId}/agents/config-pr`, {
        method: "POST",
        body: JSON.stringify({ agents }),
      });
      setConfigPr(result);
      setBaseline({ ...draft });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save configuration");
    } finally {
      setSavingConfig(false);
    }
  }

  function discardDraft() {
    setDraft({ ...baseline });
    setConfigPr(null);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Agents"
          description="Harness and model per agent are saved to factory-config via pull request."
        />
        {dirty && (
          <Button size="sm" onClick={() => void saveConfiguration()} disabled={savingConfig}>
            <Save className="mr-2 size-3.5" />
            {savingConfig ? "Saving…" : "Save configuration"}
          </Button>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {defaultsSaved && (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-100">
          {defaultsSaved}
        </div>
      )}
      {configPr && (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800 dark:border-green-900 dark:bg-green-950 dark:text-green-100">
          Pull request opened for {configPr.changed.join(", ")}.{" "}
          <a href={configPr.prUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2">
            Review on GitHub <ExternalLink className="size-3.5" />
          </a>
          {" "}Merge to update the pinned config on new work items.
        </div>
      )}
      {loading && <AgentsSkeleton />}
      {!loading && data && (
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
      {!loading && data && (
        <GlobalAgentDefaultsCard
          appliedOverrides={data.appliedAgentOverrides}
          defaultHarness={defaultHarness}
          setDefaultHarness={setDefaultHarness}
          defaultModel={defaultModel}
          setDefaultModel={setDefaultModel}
          onSave={applyDefaults}
          onClear={clearDefaults}
          saving={savingDefaults}
        />
      )}
      {!loading && data && (
        <section className="space-y-3">
          <h2 className="font-heading text-lg font-semibold tracking-tight">Agents</h2>
          {data.agents.map((agent) => (
            <AgentCard
              key={agent.name}
              agent={agent}
              projectId={projectId}
              runConfig={draft[agent.name] ?? { harness: agent.harness, model: agent.model }}
              dirty={
                baseline[agent.name]?.harness !== draft[agent.name]?.harness ||
                baseline[agent.name]?.model !== draft[agent.name]?.model
              }
              onHarnessChange={(harness) => updateAgent(agent.name, { harness })}
              onModelChange={(model) => updateAgent(agent.name, { model })}
              onHarnessModelPicked={(harness, model) => updateAgent(agent.name, { harness, model })}
            />
          ))}
        </section>
      )}

      <AlertDialog open={blocker.state === "blocked"}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard agent changes?</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved harness or model edits. Leave this page and discard them, or stay to finish saving.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                if (blocker.state === "blocked") blocker.reset();
              }}
            >
              Stay
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                discardDraft();
                if (blocker.state === "blocked") blocker.proceed();
              }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AgentsSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading agents">
      <section className="space-y-3">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-3 w-64" style={{ animationDelay: "60ms" }} />
        <Skeleton className="h-40 w-full rounded-xl" style={{ animationDelay: "120ms" }} />
        <Skeleton className="h-28 w-full rounded-xl" style={{ animationDelay: "180ms" }} />
      </section>
      <section className="space-y-3">
        <Skeleton className="h-5 w-20" style={{ animationDelay: "220ms" }} />
        {[0, 1, 2, 3].map((i) => (
          <Skeleton
            key={i}
            className="h-12 w-full rounded-xl"
            style={{ animationDelay: `${260 + i * 80}ms` }}
          />
        ))}
      </section>
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
  const active = Boolean(appliedOverrides.harness || appliedOverrides.model);

  return (
    <Card size="sm" className={active ? "border-amber-300" : ""}>
      <CardHeader className="border-b pb-3">
        <div className="flex items-center gap-2">
          <CardTitle>Run defaults</CardTitle>
          {active && <Badge variant="secondary">Active</Badge>}
        </div>
        <CardDescription>
          Optional runtime override for new runs. Does not change agent.md — use Save configuration below for that.
          When active, runs ignore per-agent values until you clear this.
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
                {HARNESSES.map((harness) => (
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

function AgentCard({
  agent,
  projectId,
  runConfig,
  dirty,
  onHarnessChange,
  onModelChange,
  onHarnessModelPicked,
}: {
  agent: ConfigAgent;
  projectId: string;
  runConfig: AgentRunConfig;
  dirty: boolean;
  onHarnessChange: (harness: string) => void;
  onModelChange: (model: string) => void;
  onHarnessModelPicked: (harness: string, model: string) => void;
}) {
  const [models, setModels] = useState<string[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);

  useEffect(() => {
    let cancel = false;
    setLoadingModels(true);
    void api<HarnessModelsResponse>(`/api/projects/${projectId}/models?harness=${encodeURIComponent(runConfig.harness)}`)
      .then((res) => {
        if (cancel) return;
        setModels(modelOptions(res.models, runConfig.model));
        setModelsError(res.error ?? null);
      })
      .catch((err) => {
        if (!cancel) {
          setModels(modelOptions([], runConfig.model));
          setModelsError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancel) setLoadingModels(false);
      });
    return () => {
      cancel = true;
    };
  }, [projectId, runConfig.harness]);

  function onHarnessPick(nextHarness: string) {
    void api<HarnessModelsResponse>(`/api/projects/${projectId}/models?harness=${encodeURIComponent(nextHarness)}`)
      .then((res) => {
        const options = modelOptions(res.models, runConfig.model);
        const model = pickModelOnHarnessChange(options, runConfig.model);
        onHarnessModelPicked(nextHarness, model);
      })
      .catch(() => {
        onHarnessChange(nextHarness);
      });
  }

  const modelChoices = modelOptions(models, runConfig.model);

  return (
    <Collapsible defaultOpen={dirty}>
      <Card size="sm" className={`py-0 ${dirty ? "border-primary/40" : ""}`}>
        <div className="flex items-center pr-3">
          <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-2 px-4 py-3 text-left">
            <AgentChip agentType={agent.agentType} />
            <CardTitle>{agent.name}</CardTitle>
            <Badge variant="secondary">{agent.agentType}</Badge>
            <Badge variant="outline">{runConfig.harness}</Badge>
            <Badge variant="outline" className="max-w-[12rem] truncate">
              {runConfig.model}
            </Badge>
            {dirty && <Badge variant="default">edited</Badge>}
            <ChevronDown className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
          </CollapsibleTrigger>
          <EditOnGitHub href={agent.editUrl} />
        </div>
        <CollapsibleContent>
          <CardContent className="grid gap-3 border-t pt-3 pb-4">
            <p className="text-sm text-muted-foreground">{agent.description}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label className="text-xs">Harness</Label>
                <Select value={runConfig.harness} onValueChange={onHarnessPick}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HARNESSES.map((harness) => (
                      <SelectItem key={harness} value={harness}>
                        {harness}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">Model</Label>
                {modelChoices.length > 0 ? (
                  <Select
                    value={runConfig.model}
                    onValueChange={onModelChange}
                    disabled={loadingModels}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {modelChoices.map((model) => (
                        <SelectItem key={model} value={model}>
                          {model}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    autoComplete="off"
                    value={runConfig.model}
                    onChange={(event) => onModelChange(event.target.value)}
                    disabled={loadingModels}
                  />
                )}
                {modelsError && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">{modelsError}</p>
                )}
              </div>
            </div>
            <dl className="grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
              <div>Spawned by {agent.spawnableBy.join(", ") || "—"}</div>
              <div>Idle timeout {agent.idleTimeoutMinutes} min · wait: {agent.waitForReview ? "yes" : "no"}</div>
            </dl>
            <PreBlock>{agent.instructions}</PreBlock>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}