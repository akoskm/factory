import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CircleDot } from "lucide-react";
import { api, type WorkItem } from "../api";
import { useProjectId } from "../use-project-id";
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
              <TableHead>Issue</TableHead>
              <TableHead className="pr-4">PR</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && (
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
