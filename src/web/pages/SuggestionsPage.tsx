import { useEffect, useState } from "react";
import { api, type ConfigAgentsResponse } from "../api";
import { useProjectId } from "../use-project-id";
import { PageHeader } from "@/components/page-header";
import { PrLink } from "@/components/pr-link";
import { PreBlock } from "@/components/pre-block";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Suggestion = {
  id: string;
  title: string;
  body: string;
  prUrl: string | null;
  status: string;
  createdAt: string;
};

export function SuggestionsPage() {
  const projectId = useProjectId();
  const [rows, setRows] = useState<Suggestion[]>([]);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<Suggestion[]>(`/api/projects/${projectId}/suggestions`).then(setRows);
    void api<ConfigAgentsResponse>(`/api/projects/${projectId}/agents`)
      .then((config) => setFileUrl(config.learnAgentFileUrl))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [projectId]);

  async function runNow() {
    setRunning(true);
    setNotice(null);
    setError(null);
    try {
      const result = await api<{ externalId: string; agentName: string }>(
        `/api/projects/${projectId}/learn`,
        { method: "POST" },
      );
      setNotice(`Learn started for #${result.externalId} (${result.agentName})`);
      void api<Suggestion[]>(`/api/projects/${projectId}/suggestions`).then(setRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Suggestions">
        <div className="flex items-center gap-2">
          <Button variant="outline" disabled={running} onClick={() => void runNow()}>
            {running ? "Starting…" : "Run now"}
          </Button>
          {fileUrl ? (
            <Button asChild>
              <a href={fileUrl} target="_blank" rel="noreferrer">
                Configure
              </a>
            </Button>
          ) : (
            <Button disabled>Configure</Button>
          )}
        </div>
      </PageHeader>
      {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {rows.map((s) => (
        <Card key={s.id}>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2">
                {s.title}
                <StatusBadge status={s.status} />
              </CardTitle>
              {s.prUrl && <PrLink href={s.prUrl} label="PR" />}
            </div>
          </CardHeader>
          <CardContent>
            <PreBlock>{s.body}</PreBlock>
          </CardContent>
        </Card>
      ))}
      {!rows.length && <p className="text-sm text-muted-foreground">No learning suggestions yet.</p>}
    </div>
  );
}
