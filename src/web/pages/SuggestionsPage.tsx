import { useEffect, useState } from "react";
import { api } from "../api";
import { useProjectId } from "../use-project-id";
import { PageHeader } from "@/components/page-header";
import { PrLink } from "@/components/pr-link";
import { PreBlock } from "@/components/pre-block";
import { StatusBadge } from "@/components/status-badge";
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

  useEffect(() => {
    void api<Suggestion[]>(`/api/projects/${projectId}/suggestions`).then(setRows);
  }, [projectId]);

  return (
    <div className="space-y-6">
      <PageHeader title="Suggestions" />
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
