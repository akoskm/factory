import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { cn } from "cn";
import { api, type ConfigAgentsResponse } from "../api";
import { useProjectId } from "../use-project-id";
import { PageHeader } from "@/components/page-header";
import { PrLink } from "@/components/pr-link";
import { PreBlock } from "@/components/pre-block";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

type Suggestion = {
  id: string;
  title: string;
  summary: string | null;
  problem: string | null;
  solution: string | null;
  body: string;
  targetAgent: string | null;
  prUrl: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  runCount: number;
};

function formatAgo(iso: string): string {
  const days = Math.floor(Math.max(0, Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

export function SuggestionsPage() {
  const projectId = useProjectId();
  const [rows, setRows] = useState<Suggestion[]>([]);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    async function loadSuggestions(initial: boolean) {
      try {
        const next = await api<Suggestion[]>(`/api/projects/${projectId}/suggestions`);
        if (cancel) return;
        setRows(next);
        if (initial) setOpenId(next[0]?.id ?? null);
      } catch (err) {
        if (cancel || !initial) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    }
    void loadSuggestions(true);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void loadSuggestions(false);
    }, 30_000);
    function onVisible() {
      if (document.visibilityState === "visible") void loadSuggestions(false);
    }
    document.addEventListener("visibilitychange", onVisible);
    void api<ConfigAgentsResponse>(`/api/projects/${projectId}/agents`)
      .then((config) => {
        if (!cancel) setFileUrl(config.learnAgentFileUrl);
      })
      .catch((err) => {
        if (!cancel) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancel = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
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
      {rows.map((suggestion) => {
        const open = openId === suggestion.id;
        const structured = Boolean(suggestion.problem);
        return (
          <Collapsible
            key={suggestion.id}
            open={open}
            onOpenChange={(next) => setOpenId(next ? suggestion.id : null)}
          >
            <Card size="sm" className="py-0">
              <CollapsibleTrigger className="flex w-full items-start gap-2 px-4 py-3 text-left">
                <ChevronDown
                  className={cn("mt-0.5 size-4 shrink-0 transition-transform", open && "rotate-180")}
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{suggestion.title}</span>
                  {suggestion.summary && (
                    <span className="mt-0.5 block truncate text-sm text-muted-foreground">
                      {suggestion.summary}
                    </span>
                  )}
                </span>
                <StatusBadge status={suggestion.status} />
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatAgo(suggestion.updatedAt || suggestion.createdAt)}
                </span>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <CardContent className="grid gap-4 border-t pt-3 pb-4">
                  {structured ? (
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <p className="text-xs font-medium tracking-wide text-muted-foreground">
                          Problem
                        </p>
                        <p className="mt-1 text-sm whitespace-pre-wrap">{suggestion.problem}</p>
                      </div>
                      <div>
                        <p className="text-xs font-medium tracking-wide text-muted-foreground">
                          Solution
                        </p>
                        <p className="mt-1 text-sm whitespace-pre-wrap">
                          {suggestion.solution || "None yet."}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <PreBlock>{suggestion.body}</PreBlock>
                  )}
                  <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                    {suggestion.targetAgent && <span>{suggestion.targetAgent}</span>}
                    {suggestion.runCount > 0 && (
                      <Link
                        to={`/p/${projectId}/runs?suggestion=${suggestion.id}`}
                        className="underline-offset-4 hover:underline"
                      >
                        {suggestion.runCount} failed {suggestion.runCount === 1 ? "run" : "runs"}
                      </Link>
                    )}
                    {suggestion.prUrl && <PrLink href={suggestion.prUrl} label="PR" />}
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Card>
          </Collapsible>
        );
      })}
      {!rows.length && <p className="text-sm text-muted-foreground">No learning suggestions yet.</p>}
    </div>
  );
}
