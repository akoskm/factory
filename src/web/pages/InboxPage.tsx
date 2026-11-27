import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, CircleDot, Clock3, Inbox } from "lucide-react";
import { cn } from "cn";
import { DropdownMenu } from "radix-ui";
import { api, type InboxFilter, type InboxItem, type InboxListResponse } from "../api";
import { issueLabel } from "../issue-label";
import { useProjectId } from "../use-project-id";
import { displayError } from "../work-item-overview";
import { PageHeader } from "@/components/page-header";
import { PrLink } from "@/components/pr-link";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function rowMeta(item: InboxItem, filter: InboxFilter): string {
  if (filter === "snoozed") return `Until ${formatWhen(item.snoozedUntil)}`;
  if (filter === "completed") return `Archived ${formatWhen(item.dismissedAt)}`;
  return `Waiting since ${formatWhen(item.createdAt)}`;
}

const menuContentClass =
  "z-50 min-w-40 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md";
const menuItemClass =
  "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground";

function SnoozeMenu({
  disabled,
  onSnooze1h,
  onSnooze1d,
  onSnoozeUntil,
}: {
  disabled?: boolean;
  onSnooze1h: () => void;
  onSnooze1d: () => void;
  onSnoozeUntil: () => void;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          disabled={disabled}
          aria-label="Snooze"
          title="Snooze"
          onClick={(e) => e.stopPropagation()}
        >
          <Clock3 />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className={menuContentClass}
          onClick={(e) => e.stopPropagation()}
        >
          <DropdownMenu.Item className={menuItemClass} onSelect={onSnooze1h}>
            1 hour
          </DropdownMenu.Item>
          <DropdownMenu.Item className={menuItemClass} onSelect={onSnooze1d}>
            1 day
          </DropdownMenu.Item>
          <DropdownMenu.Item className={menuItemClass} onSelect={onSnoozeUntil}>
            Until…
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
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
          {error && <p className="px-4 pt-3 text-sm text-destructive">{error}</p>}
          {items.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">{emptyLabel}</p>
          ) : (
            <ul>
              {items.map((item) => (
                <li
                  key={item.id}
                  className="group relative border-b border-border/70 bg-card transition-colors last:border-b-0 hover:bg-muted/50"
                >
                  <Link
                    to={`/p/${item.projectId}/work/${item.id}`}
                    className="absolute inset-0"
                    aria-label={item.title}
                  />
                  <div className="relative z-10 pointer-events-none flex items-center gap-3 px-4 py-3.5">
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="truncate text-sm font-medium leading-snug">
                        {item.holdKind === "proof"
                          ? "Proof review · "
                          : item.holdKind === "bootstrap"
                            ? "Proof setup · "
                            : ""}
                        {item.title}
                      </p>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {rowMeta(item, queryFilter)}
                      </p>
                      {item.error && queryFilter !== "completed" && (
                        <p className="line-clamp-2 text-xs text-muted-foreground">
                          {displayError(item.error)}
                        </p>
                      )}
                    </div>
                    <div className="pointer-events-auto flex shrink-0 items-center gap-2">
                      {item.url ? (
                        <PrLink
                          href={item.url}
                          label={issueLabel(item.url)}
                          icon={<CircleDot />}
                        />
                      ) : null}
                      {item.prUrl ? <PrLink href={item.prUrl} label="PR" /> : null}
                      {queryFilter === "active" && (
                        <SnoozeMenu
                          disabled={busyId === item.id}
                          onSnooze1h={() =>
                            void snooze(item, new Date(Date.now() + 60 * 60 * 1000))
                          }
                          onSnooze1d={() =>
                            void snooze(item, new Date(Date.now() + 24 * 60 * 60 * 1000))
                          }
                          onSnoozeUntil={() => {
                            setCustomUntil(defaultCustomUntil());
                            setCustomFor(item);
                          }}
                        />
                      )}
                      {queryFilter === "snoozed" && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={busyId === item.id}
                          onClick={() => void unsnooze(item)}
                        >
                          Unsnooze
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
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
