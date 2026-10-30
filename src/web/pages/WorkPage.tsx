import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type WorkItem } from "../api";
import { useProjectId } from "../use-project-id";
import { PageHeader } from "@/components/page-header";
import { PrLink } from "@/components/pr-link";
import { LiveSurface, StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
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

  useEffect(() => {
    void api<WorkItem[]>(`/api/projects/${projectId}/work-items`).then(setItems);
  }, [projectId]);

  return (
    <div className="space-y-6">
      <PageHeader title="Work" />
      <Card className="min-w-0 py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Title</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Agent</TableHead>
              <TableHead className="pr-4">PR</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                  No work items yet
                </TableCell>
              </TableRow>
            )}
            {items.map((item) => (
              <TableRow key={item.id} className={item.status === "running" ? "status-live-row" : undefined}>
                <TableCell className="pl-4 whitespace-normal">
                  <LiveSurface active={item.status === "running"} className="pl-2">
                    <Link
                      to={`/p/${projectId}/work/${item.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {item.title}
                    </Link>
                  </LiveSurface>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={item.status} />
                    {item.waitingForReview && <Badge variant="outline">needs review</Badge>}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {item.currentAgent ?? "—"}
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
