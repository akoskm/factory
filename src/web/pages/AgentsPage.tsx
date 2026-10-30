import { useEffect, useState } from "react";
import { api, type ConfigAgentsResponse } from "../api";
import { useProjectId } from "../use-project-id";
import { PageHeader } from "@/components/page-header";
import { PreBlock } from "@/components/pre-block";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function AgentsPage() {
  const projectId = useProjectId();
  const [data, setData] = useState<ConfigAgentsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<ConfigAgentsResponse>(`/api/projects/${projectId}/agents`)
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [projectId]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agents"
        description="Read from factory-config. Edit agents/*/agent.md and pipeline.yaml in that repo."
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      {data && (
        <p className="text-sm text-muted-foreground font-mono">
          {data.configRepo} @ {data.configSha.slice(0, 12)}
        </p>
      )}
      {data?.agents.map((agent) => (
        <Card key={agent.name}>
          <CardHeader>
            <div className="space-y-1">
              <CardTitle className="flex flex-wrap items-center gap-2">
                {agent.name}
                <Badge variant="secondary">{agent.agentType}</Badge>
                <Badge variant="outline">{agent.harness}</Badge>
                <Badge variant="outline">{agent.model}</Badge>
                <Badge variant="outline">
                  wait: {agent.waitForReview ? "yes" : "no"}
                </Badge>
              </CardTitle>
              <p className="text-sm text-muted-foreground">{agent.description}</p>
            </div>
          </CardHeader>
          <CardContent>
            <PreBlock>{agent.instructions}</PreBlock>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
