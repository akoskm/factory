import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { api, type ConfigAgent, type ConfigAgentsResponse } from "../api";
import { useProjectId } from "../use-project-id";
import { PageHeader } from "@/components/page-header";
import { PipelineFlow } from "@/components/pipeline-flow";
import { PreBlock } from "@/components/pre-block";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export function AgentsPage() {
  const projectId = useProjectId();
  const [data, setData] = useState<ConfigAgentsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<ConfigAgentsResponse>(`/api/projects/${projectId}/agents`)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [projectId]);

  const hub = data?.pipeline.routes.default || data?.pipeline.startAgent;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agents"
        description="Read from factory-config. Edit agents/*/agent.md and pipeline.yaml in that repo."
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      {data && (
        <section className="space-y-3">
          <div className="space-y-1">
            <h2 className="font-heading text-lg font-semibold tracking-tight">Pipeline</h2>
            <p className="font-mono text-sm text-muted-foreground">
              {data.configRepo} @ {data.configSha.slice(0, 12)}
            </p>
            <p className="text-sm text-muted-foreground">
              {hub} spawns the workspace agents, and those agents return to {hub} on the default route. Extra edges are the other routes and the onComplete list, in order.
            </p>
          </div>
          <PipelineFlow pipeline={data.pipeline} />
          <Collapsible defaultOpen>
            <Card size="sm" className="py-0">
              <CollapsibleTrigger className="group flex w-full items-center gap-2 px-4 py-3 text-left">
                <span className="font-mono text-sm">pipeline.yaml</span>
                <ChevronDown className="ml-auto size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="border-t pt-3 pb-4">
                  <PreBlock>{data.pipelineYaml}</PreBlock>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        </section>
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

function AgentCard({ agent }: { agent: ConfigAgent }) {
  return (
    <Collapsible>
      <Card size="sm" className="py-0">
        <CollapsibleTrigger className="group flex w-full items-center gap-2 px-4 py-3 text-left">
          <CardTitle>{agent.name}</CardTitle>
          <Badge variant="secondary">{agent.agentType}</Badge>
          <Badge variant="outline">{agent.harness}</Badge>
          <Badge variant="outline">{agent.model}</Badge>
          <Badge variant="outline">wait: {agent.waitForReview ? "yes" : "no"}</Badge>
          <ChevronDown className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        </CollapsibleTrigger>
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
