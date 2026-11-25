import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CircleDot } from "lucide-react";
import { api, type Project, type WorkItem } from "../api";
import { useProjectId } from "../use-project-id";
import {
  countInPipeline,
  countRunningSlots,
  shouldShowWorkPageStrip,
} from "../work-page-counts";
import { PageHeader } from "@/components/page-header";
import { PrLink } from "@/components/pr-link";
import { issueLabel } from "../issue-label";
import { StatusBadge } from "@/components/status-badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function WorkPage() {
  const projectId = useProjectId();
  const [items, setItems] = useState<WorkItem[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    void Promise.all([
      api<Project>(`/api/projects/${projectId}`),
      api<WorkItem[]>(`/api/projects/${projectId}/work-items`),
    ])
      .then(([proj, workItems]) => {
        setProject(proj);
        setItems(workItems);
      })
      .finally(() => setLoading(false));
  }, [projectId]);

  const inUse = countRunningSlots(items);
  const cap = project?.maxConcurrentRuns ?? 1;
  const showStrip = !loading && shouldShowWorkPageStrip(items, inUse);
  const pipelineCount = countInPipeline(items);

  return (
    <div className="space-y-6">
      <PageHeader title="Work" />
      <Card className="min-w-0 py-0">
        {loading && (
          <div className="border-b px-4 py-2.5 text-sm text-muted-foreground">Loading…</div>
        )}
        {!loading && showStrip && (
          <div className="border-b px-4 py-2.5 text-sm">
            <div className="font-medium">
              {inUse} of {cap} slots in use
            </div>
            {pipelineCount > 0 && (
              <div className="text-muted-foreground">{pipelineCount} in pipeline</div>
            )}
          </div>
        )}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Title</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead>Issue</TableHead>
              <TableHead className="pr-4">PR</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!loading && items.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  No work items yet
                </TableCell>
              </TableRow>
            )}
            {items.map((item) => (
              <TableRow key={item.id} className={item.status === "running" ? "status-live-row" : undefined}>
                <TableCell className="pl-4 whitespace-normal">
                  <Link
                    to={`/p/${projectId}/work/${item.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {item.title}
                  </Link>
                </TableCell>
                <TableCell>
                  <StatusBadge status={item.status} />
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {item.currentAgent ?? "—"}
                </TableCell>
                <TableCell>
                  {item.url ? (
                    <PrLink href={item.url} label={issueLabel(item.url)} icon={<CircleDot />} />
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="pr-4">
                  {item.prUrl ? <PrLink href={item.prUrl} label="PR" /> : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}