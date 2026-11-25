import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { CircleDot } from "lucide-react";
import { api, type Project, type WorkItem } from "../api";
import { useProjectId } from "../use-project-id";
import { PageHeader } from "@/components/page-header";
import { PrLink } from "@/components/pr-link";
import { QueueActions } from "@/components/queue-actions";
import { issueLabel } from "../issue-label";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  countRunningSlots,
  countRunningWorkItems,
  workPageCapacityBaseText,
} from "../work-page-counts";

const ACTIVE = new Set(["running", "waiting_review", "needs_user"]);
const WAITING = new Set(["queued", "scheduled"]);
const AVAILABLE = new Set(["listed"]);

function toLocalDatetimeValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultScheduleAt(): string {
  return toLocalDatetimeValue(new Date(Date.now() + 2 * 60 * 60 * 1000));
}

function canQueue(status: string): boolean {
  return status === "listed" || status === "scheduled";
}

function canDequeue(status: string): boolean {
  return status === "queued" || status === "scheduled";
}

function formatWhen(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sortQueued(a: WorkItem, b: WorkItem): number {
  if (a.status === "queued" && b.status === "queued") {
    return (a.queuedAt ?? "").localeCompare(b.queuedAt ?? "");
  }
  if (a.status === "queued") return -1;
  if (b.status === "queued") return 1;
  return (a.scheduledFor ?? "").localeCompare(b.scheduledFor ?? "");
}

function shortTitle(title: string, max = 36): string {
  if (title.length <= max) return title;
  return `${title.slice(0, max - 1)}…`;
}

function statusDetail(
  item: WorkItem,
  projectId: string,
  blocker: WorkItem | undefined,
): ReactNode {
  if (item.status === "scheduled") {
    const when = formatWhen(item.scheduledFor);
    return when ? `starts ${when}` : null;
  }
  if (item.status === "queued") {
    const when = formatWhen(item.queuedAt);
    const since = when ? ` · since ${when}` : "";
    if (blocker) {
      return (
        <>
          blocked by{" "}
          <Link
            to={`/p/${projectId}/work/${blocker.id}`}
            className="underline-offset-2 hover:underline"
          >
            {shortTitle(blocker.title)}
          </Link>
          {since}
        </>
      );
    }
    return `next when a run finishes${since}`;
  }
  if (item.status === "needs_user") return "waiting on you — blocks new runs";
  if (item.status === "waiting_review") return "waiting on review — blocks new runs";
  return null;
}

type RowActions = {
  busyId: string | null;
  onEnqueue: (item: WorkItem, mode: "queue" | "queue_and_start") => void;
  onDequeue: (item: WorkItem) => void;
  onSchedule: (item: WorkItem) => void;
};

function SectionLabel({
  children,
  first,
}: {
  children: ReactNode;
  first?: boolean;
}) {
  return (
    <TableRow
      className={
        first
          ? "hover:bg-transparent"
          : "border-t-4 border-border hover:bg-transparent"
      }
    >
      <TableCell
        colSpan={6}
        className="bg-muted/60 py-3 pl-4 text-xs font-semibold tracking-wide text-foreground uppercase"
      >
        {children}
      </TableCell>
    </TableRow>
  );
}

function ItemRow({
  projectId,
  item,
  blocker,
  actions,
}: {
  projectId: string;
  item: WorkItem;
  blocker: WorkItem | undefined;
  actions: RowActions;
}) {
  const detail = statusDetail(item, projectId, blocker);
  return (
    <TableRow className={item.status === "running" ? "status-live-row" : undefined}>
      <TableCell className="max-w-[28rem] pl-4 whitespace-normal">
        <Link
          to={`/p/${projectId}/work/${item.id}`}
          className="font-medium underline-offset-4 hover:underline"
        >
          {item.title}
        </Link>
      </TableCell>
      <TableCell className="align-top">
        <div className="flex flex-col items-start gap-0.5">
          <StatusBadge status={item.status} />
          {detail && (
            <span className="max-w-[16rem] text-xs text-muted-foreground whitespace-normal">
              {detail}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell className="text-muted-foreground">{item.currentAgent ?? "—"}</TableCell>
      <TableCell>
        {item.url ? (
          <PrLink href={item.url} label={issueLabel(item.url)} icon={<CircleDot />} />
        ) : (
          "—"
        )}
      </TableCell>
      <TableCell>
        {item.prUrl ? <PrLink href={item.prUrl} label="PR" /> : "—"}
      </TableCell>
      <TableCell className="pr-4">
        {canQueue(item.status) || canDequeue(item.status) ? (
          <div className="flex flex-wrap items-center gap-2">
            {canQueue(item.status) && (
              <QueueActions
                disabled={actions.busyId === item.id}
                onQueue={() => actions.onEnqueue(item, "queue")}
                onQueueAndStart={() => actions.onEnqueue(item, "queue_and_start")}
                onSchedule={() => actions.onSchedule(item)}
              />
            )}
            {canDequeue(item.status) && (
              <Button
                size="sm"
                variant="outline"
                disabled={actions.busyId === item.id}
                onClick={() => actions.onDequeue(item)}
              >
                Remove
              </Button>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
    </TableRow>
  );
}

function EmptySection({ message }: { message: string }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={6} className="py-4 pl-4 text-muted-foreground">
        {message}
      </TableCell>
    </TableRow>
  );
}

export function WorkPage() {
  const projectId = useProjectId();
  const [items, setItems] = useState<WorkItem[]>([]);
  const [cap, setCap] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scheduleFor, setScheduleFor] = useState<WorkItem | null>(null);
  const [scheduleAt, setScheduleAt] = useState(defaultScheduleAt);

  const load = useCallback(() => {
    void api<WorkItem[]>(`/api/projects/${projectId}/work-items`)
      .then(setItems)
      .catch(() => setItems([]));
    void api<Project>(`/api/projects/${projectId}`)
      .then((p) => setCap(Math.max(1, p.maxConcurrentRuns ?? 1)))
      .catch(() => setCap(1));
  }, [projectId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [load]);

  const { active, waiting, available, earlier } = useMemo(() => {
    const active = items.filter((i) => ACTIVE.has(i.status));
    const waiting = items.filter((i) => WAITING.has(i.status)).sort(sortQueued);
    const available = items.filter((i) => AVAILABLE.has(i.status));
    const earlier = items
      .filter((i) => !ACTIVE.has(i.status) && !WAITING.has(i.status) && !AVAILABLE.has(i.status))
      .sort((a, b) => b.kickoffAt.localeCompare(a.kickoffAt));
    return { active, waiting, available, earlier };
  }, [items]);

  const slotsUsed = countRunningSlots(items);
  const runningCount = countRunningWorkItems(items);
  const slotsFull = slotsUsed >= cap;
  const blocker = slotsFull ? active[0] : undefined;

  const actions: RowActions = {
    busyId,
    onEnqueue: (item, mode) => void enqueue(item, mode),
    onDequeue: (item) => void dequeue(item),
    onSchedule: (item) => {
      setScheduleAt(defaultScheduleAt());
      setScheduleFor(item);
    },
  };

  async function enqueue(item: WorkItem, mode: "queue" | "queue_and_start") {
    setBusyId(item.id);
    setError(null);
    try {
      await api(`/api/work-items/${item.id}/queue`, {
        method: "POST",
        body: JSON.stringify({ mode }),
      });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function dequeue(item: WorkItem) {
    setBusyId(item.id);
    setError(null);
    try {
      await api(`/api/work-items/${item.id}/dequeue`, { method: "POST" });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function submitSchedule() {
    if (!scheduleFor) return;
    setBusyId(scheduleFor.id);
    setError(null);
    try {
      await api(`/api/work-items/${scheduleFor.id}/queue`, {
        method: "POST",
        body: JSON.stringify({
          mode: "schedule",
          scheduledFor: new Date(scheduleAt).toISOString(),
        }),
      });
      setScheduleFor(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Work"
        description="Tasks are ready to queue. The factory queue is what runs."
      />
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          {workPageCapacityBaseText(slotsUsed, cap, runningCount)}
          {blocker && (
            <>
              {" "}
              · blocked by{" "}
              <Link
                to={`/p/${projectId}/work/${blocker.id}`}
                className="underline-offset-4 hover:underline"
              >
                {blocker.title}
              </Link>{" "}
              ({blocker.status.replaceAll("_", " ")})
            </>
          )}
        </p>

        <Card className="min-w-0 overflow-hidden py-0">
          <Table className="table-fixed">
            <colgroup>
              <col className="w-[36%]" />
              <col className="w-[22%]" />
              <col className="w-[10%]" />
              <col className="w-[12%]" />
              <col className="w-[8%]" />
              <col className="w-[12%]" />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Title</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Agent</TableHead>
                <TableHead>Issue</TableHead>
                <TableHead>PR</TableHead>
                <TableHead className="pr-4">Queue</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <SectionLabel first>
                Active now
                {active.length > 0 ? ` · ${active.length}` : ""}
              </SectionLabel>
              {active.length === 0 ? (
                <EmptySection message="Nothing active" />
              ) : (
                active.map((item) => (
                  <ItemRow
                    key={item.id}
                    projectId={projectId}
                    item={item}
                    blocker={blocker}
                    actions={actions}
                  />
                ))
              )}

              <SectionLabel>
                Waiting to start
                {waiting.length > 0
                  ? ` · ${waiting.filter((w) => w.status === "queued").length} queued${
                      waiting.some((w) => w.status === "scheduled")
                        ? `, ${waiting.filter((w) => w.status === "scheduled").length} scheduled`
                        : ""
                    }`
                  : ""}
              </SectionLabel>
              {waiting.length === 0 ? (
                <EmptySection message="Nothing waiting" />
              ) : (
                waiting.map((item) => (
                  <ItemRow
                    key={item.id}
                    projectId={projectId}
                    item={item}
                    blocker={blocker}
                    actions={actions}
                  />
                ))
              )}

              <SectionLabel>Tasks · ready to queue</SectionLabel>
              {available.length === 0 ? (
                <EmptySection message="No tasks ready to queue" />
              ) : (
                available.map((item) => (
                  <ItemRow
                    key={item.id}
                    projectId={projectId}
                    item={item}
                    blocker={blocker}
                    actions={actions}
                  />
                ))
              )}

              {earlier.length > 0 && (
                <>
                  <SectionLabel>Done</SectionLabel>
                  {earlier.map((item) => (
                    <ItemRow
                      key={item.id}
                      projectId={projectId}
                      item={item}
                      blocker={blocker}
                      actions={actions}
                    />
                  ))}
                </>
              )}
            </TableBody>
          </Table>
        </Card>
      </div>

      <Dialog open={scheduleFor != null} onOpenChange={(o) => !o && setScheduleFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Joins the queue at this time. Same as Queue, just delayed.
          </p>
          <div className="space-y-2">
            <Label htmlFor="schedule-at">Start at</Label>
            <Input
              id="schedule-at"
              type="datetime-local"
              value={scheduleAt}
              onChange={(e) => setScheduleAt(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setScheduleFor(null)}>
              Cancel
            </Button>
            <Button disabled={busyId === scheduleFor?.id} onClick={() => void submitSchedule()}>
              Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
