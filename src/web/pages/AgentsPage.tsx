import { useEffect, useState } from "react";
import { api, type Agent } from "../api";
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

const MODELS_BY_HARNESS: Record<string, string[]> = {
  cursor: ["composer-2", "auto"],
  "claude-code": ["claude-sonnet-4-5", "claude-opus-4-5", "claude-haiku-4-5"],
};

function defaultModel(harness: string): string {
  return MODELS_BY_HARNESS[harness]?.[0] ?? "composer-2";
}

function modelsFor(harness: string, current: string): string[] {
  const list = MODELS_BY_HARNESS[harness] ?? [current];
  return list.includes(current) ? list : [current, ...list];
}

function waitMode(agent: Agent): "default" | "always" | "never" {
  if (agent.waitForReview === true) return "always";
  if (agent.waitForReview === false) return "never";
  return "default";
}

export function AgentsPage() {
  const projectId = useProjectId();
  const [agents, setAgents] = useState<Agent[]>([]);

  async function load() {
    setAgents(await api<Agent[]>(`/api/projects/${projectId}/agents`));
  }

  useEffect(() => {
    void load();
  }, [projectId]);

  async function patchAgent(id: string, body: Record<string, unknown>) {
    await api(`/api/agents/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    await load();
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
            await load();
          }}
        >
          Sync from files
        </Button>
      </PageHeader>
      {agents.map((agent) => {
        const models = modelsFor(agent.harness, agent.model);
        const invalidPair = !(MODELS_BY_HARNESS[agent.harness] ?? []).includes(agent.model);
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
                    void patchAgent(agent.id, { harness, model: defaultModel(harness) });
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
                  onValueChange={(model) => void patchAgent(agent.id, { model })}
                >
                  <SelectTrigger className="w-56">
                    <SelectValue />
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
