import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, CircleDot, Clock3, Inbox } from "lucide-react";
import { cn } from "cn";
import { api, type InboxFilter, type InboxItem, type InboxListResponse } from "../api";
import { issueLabel } from "../issue-label";
import { useProjectId } from "../use-project-id";
import { displayError } from "../work-item-overview";
import { PageHeader } from "@/components/page-header";
import { PrLink } from "@/components/pr-link";
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

const FOLDERS: {
  id: InboxFilter;
  label: string;
  icon: typeof Inbox;
}[] = [
  { id: "active", label: "Inbox", icon: Inbox },
  { id: "snoozed", label: "Snoozed", icon: Clock3 },
  { id: "completed", label: "Completed", icon: CheckCircle2 },
];

function toLocalDatetimeValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultCustomUntil(): string {
  const d = new Date(Date.now() + 4 * 60 * 60 * 1000);
  return toLocalDatetimeValue(d);
}

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function kindLabel(item: InboxItem): string {
  if (item.takenOver) return "Steer";
  if (item.phase === "ship") return "Ship";
  return "Needs you";
}

export function InboxPage({ onUnreadCount }: { onUnreadCount?: (n: number) => void }) {
  const projectId = useProjectId();
  const [params, setParams] = useSearchParams();
  const filter = (params.get("filter") as InboxFilter) || "active";
  const [items, setItems] = useState<InboxItem[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [customFor, setCustomFor] = useState<InboxItem | null>(null);
  const [customUntil, setCustomUntil] = useState(defaultCustomUntil);
  const [error, setError] = useState<string | null>(null);

  const queryFilter: InboxFilter =
    filter === "snoozed" || filter === "completed" ? filter : "active";

  const load = useCallback(async () => {
    const q = new URLSearchParams({ filter: queryFilter, projectId });
    const data = await api<InboxListResponse>(`/api/inbox?${q}`);
    setItems(data.items);
    onUnreadCount?.(data.activeCount);
  }, [queryFilter, projectId, onUnreadCount]);

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => {
      void load().catch(() => {});
    }, 15_000);
    return () => clearInterval(timer);
  }, [load]);

  function setFilter(next: InboxFilter) {
    const nextParams = new URLSearchParams(params);
    if (next === "active") nextParams.delete("filter");
    else nextParams.set("filter", next);
    setParams(nextParams);
  }

  async function snooze(item: InboxItem, until: Date) {
    setBusyId(item.id);
    setError(null);
    try {
      await api(`/api/inbox/${item.id}/snooze`, {
        method: "POST",
        body: JSON.stringify({ until: until.toISOString() }),
      });
      setCustomFor(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function unsnooze(item: InboxItem) {
    setBusyId(item.id);
    setError(null);
    try {
      await api(`/api/inbox/${item.id}/unsnooze`, { method: "POST", body: "{}" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  const emptyLabel = useMemo(() => {
    if (queryFilter === "snoozed") return "Nothing snoozed";
    if (queryFilter === "completed") return "No archived inbox items";
    return "Nothing needs you";
  }, [queryFilter]);

  const folderTitle = FOLDERS.find((f) => f.id === queryFilter)?.label ?? "Inbox";

  return (
    <div className="space-y-6">
      <PageHeader title="Inbox" />
      <div className="flex min-h-[28rem] gap-0 overflow-hidden rounded-lg border bg-card">
        <nav className="flex w-44 shrink-0 flex-col gap-0.5 border-r bg-muted/20 p-2">
          {FOLDERS.map((folder) => {
            const Icon = folder.icon;
            const active = queryFilter === folder.id;
            return (
              <button
                key={folder.id}
                type="button"
                onClick={() => setFilter(folder.id)}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span className="truncate">{folder.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="min-w-0 flex-1">
          <div className="border-b px-4 py-2.5 text-sm font-medium">{folderTitle}</div>
          {error && <p className="px-4 pt-3 text-sm text-destructive">{error}</p>}
          <Card className="border-0 py-0 shadow-none">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Title</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>
                    {queryFilter === "snoozed"
                      ? "Until"
                      : queryFilter === "completed"
                        ? "Archived"
                        : "Waiting since"}
                  </TableHead>
                  <TableHead className="pr-4">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      {emptyLabel}
                    </TableCell>
                  </TableRow>
                )}
                {items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="pl-4 whitespace-normal">
                      <div className="space-y-1">
                        <Link
                          to={`/p/${item.projectId}/work/${item.id}`}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {item.title}
                        </Link>
                        {item.error && queryFilter !== "completed" && (
                          <p className="line-clamp-2 text-xs text-muted-foreground">
                            {displayError(item.error)}
                          </p>
                        )}
                        <div className="flex flex-wrap gap-2">
                          {item.url ? (
                            <PrLink
                              href={item.url}
                              label={issueLabel(item.url)}
                              icon={<CircleDot />}
                            />
                          ) : null}
                          {item.prUrl ? <PrLink href={item.prUrl} label="PR" /> : null}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{kindLabel(item)}</TableCell>
                    <TableCell>
                      <StatusBadge status={item.status} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {queryFilter === "snoozed"
                        ? formatWhen(item.snoozedUntil)
                        : queryFilter === "completed"
                          ? formatWhen(item.dismissedAt)
                          : formatWhen(item.blockedAt)}
                    </TableCell>
                    <TableCell className="pr-4">
                      <div className="flex flex-wrap gap-1">
                        <Button size="sm" variant="outline" asChild>
                          <Link to={`/p/${item.projectId}/work/${item.id}`}>Open</Link>
                        </Button>
                        {queryFilter === "active" && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busyId === item.id}
                              onClick={() =>
                                void snooze(item, new Date(Date.now() + 60 * 60 * 1000))
                              }
                            >
                              1h
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busyId === item.id}
                              onClick={() =>
                                void snooze(item, new Date(Date.now() + 24 * 60 * 60 * 1000))
                              }
                            >
                              1d
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busyId === item.id}
                              onClick={() => {
                                setCustomUntil(defaultCustomUntil());
                                setCustomFor(item);
                              }}
                            >
                              Until…
                            </Button>
                          </>
                        )}
                        {queryFilter === "snoozed" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyId === item.id}
                            onClick={() => void unsnooze(item)}
                          >
                            Unsnooze
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>
      </div>

      <Dialog open={customFor != null} onOpenChange={(open) => !open && setCustomFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Snooze until</DialogTitle>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="snooze-until">Date and time</Label>
            <Input
              id="snooze-until"
              type="datetime-local"
              value={customUntil}
              onChange={(e) => setCustomUntil(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              disabled={!customFor || !customUntil}
              onClick={() => {
                if (!customFor) return;
                void snooze(customFor, new Date(customUntil));
              }}
            >
              Snooze
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
