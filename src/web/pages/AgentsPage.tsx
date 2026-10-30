import { useEffect, useState } from "react";
import { api, type Agent, type HarnessModelsResponse } from "../api";
import { useProjectId } from "../use-project-id";
import { Field } from "@/components/field";
import { PageHeader } from "@/components/page-header";
import { PreBlock } from "@/components/pre-block";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const HARNESS_OPTIONS = ["cursor", "claude-code"] as const;

type HarnessModelsState = {
  models: string[];
  error?: string;
  loadError?: string;
  loading: boolean;
};

function emptyHarnessState(): HarnessModelsState {
  return { models: [], loading: true };
}

function modelSelectOptions(models: string[], current: string): string[] {
  if (!models.length) return current ? [current] : [];
  return models.includes(current) ? models : [current, ...models];
}

function pickModelOnHarnessChange(models: string[], current: string): string {
  if (models.includes(current)) return current;
  return models[0] ?? current;
}

function waitMode(agent: Agent): "default" | "always" | "never" {
  if (agent.waitForReview === true) return "always";
  if (agent.waitForReview === false) return "never";
  return "default";
}

export function AgentsPage() {
  const projectId = useProjectId();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [modelsByHarness, setModelsByHarness] = useState<
    Record<string, HarnessModelsState>
  >(() => Object.fromEntries(HARNESS_OPTIONS.map((h) => [h, emptyHarnessState()])));

  async function loadAgents() {
    setAgents(await api<Agent[]>(`/api/projects/${projectId}/agents`));
  }

  async function loadModelsForHarness(harness: (typeof HARNESS_OPTIONS)[number]) {
    setModelsByHarness((prev) => ({
      ...prev,
      [harness]: { ...prev[harness], loading: true, loadError: undefined },
    }));
    try {
      const res = await api<HarnessModelsResponse>(
        `/api/projects/${projectId}/models?harness=${encodeURIComponent(harness)}`,
      );
      setModelsByHarness((prev) => ({
        ...prev,
        [harness]: {
          models: res.models,
          error: res.error,
          loading: false,
        },
      }));
    } catch (err) {
      setModelsByHarness((prev) => ({
        ...prev,
        [harness]: {
          models: [],
          loadError: err instanceof Error ? err.message : String(err),
          loading: false,
        },
      }));
    }
  }

  function loadAllHarnessModels() {
    void Promise.all(HARNESS_OPTIONS.map((h) => loadModelsForHarness(h)));
  }

  useEffect(() => {
    void loadAgents();
    loadAllHarnessModels();
  }, [projectId]);

  async function patchAgent(id: string, body: Record<string, unknown>) {
    await api(`/api/agents/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    await loadAgents();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agents"
        description="Wait mode: Default inherits Factory defaults (Settings). Always / Never override for this project."
      >
        <Button
          variant="outline"
          onClick={async () => {
            await api(`/api/projects/${projectId}/agents/sync`, { method: "POST" });
            await loadAgents();
          }}
        >
          Sync from files
        </Button>
      </PageHeader>
      {agents.map((agent) => {
        const harnessState = modelsByHarness[agent.harness] ?? emptyHarnessState();
        const models = modelSelectOptions(harnessState.models, agent.model);
        const listReady =
          !harnessState.loading && !harnessState.loadError && !harnessState.error;
        const invalidPair =
          listReady && harnessState.models.length > 0 && !harnessState.models.includes(agent.model);
        const modelHint =
          harnessState.loading
            ? "Loading models…"
            : harnessState.loadError
              ? harnessState.loadError
              : harnessState.error
                ? harnessState.error
                : null;

        return (
          <Card key={agent.id}>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2">
                    {agent.name}
                    <Badge variant="secondary">{agent.agentType}</Badge>
                  </CardTitle>
                  <p className="text-sm text-muted-foreground">{agent.description}</p>
                </div>
                <div className="flex flex-wrap items-end gap-3">
                  <Field label="Wait for review">
                    <Select
                      value={waitMode(agent)}
                      onValueChange={(mode) => {
                        const waitForReview = mode === "default" ? null : mode === "always";
                        void patchAgent(agent.id, { waitForReview });
                      }}
                    >
                      <SelectTrigger className="w-52">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="default">
                          Default ({agent.instanceDefault ? "wait" : "continue"})
                        </SelectItem>
                        <SelectItem value="always">Always wait</SelectItem>
                        <SelectItem value="never">Never wait</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Badge variant="outline">
                    effective: {agent.effectiveWaitForReview ? "wait" : "continue"}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="flex flex-wrap gap-3">
                <Select
                  value={agent.harness}
                  onValueChange={(harness) => {
                    const list = modelsByHarness[harness]?.models ?? [];
                    const model = pickModelOnHarnessChange(list, agent.model);
                    void patchAgent(agent.id, { harness, model });
                  }}
                >
                  <SelectTrigger className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cursor">cursor</SelectItem>
                    <SelectItem value="claude-code">claude-code</SelectItem>
                  </SelectContent>
                </Select>
                <Select
                  value={agent.model}
                  disabled={harnessState.loading}
                  onValueChange={(model) => void patchAgent(agent.id, { model })}
                >
                  <SelectTrigger className="w-56">
                    <SelectValue placeholder={harnessState.loading ? "Loading…" : undefined} />
                  </SelectTrigger>
                  <SelectContent>
                    {models.map((model) => (
                      <SelectItem key={model} value={model}>
                        {model}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {modelHint && !invalidPair && (
                <p className="text-sm text-muted-foreground">{modelHint}</p>
              )}
              {invalidPair && (
                <Alert variant="destructive">
                  <AlertDescription>
                    Model {agent.model} is not valid for {agent.harness}. Pick another model.
                  </AlertDescription>
                </Alert>
              )}
              <PreBlock>{agent.instructions}</PreBlock>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
