import type { ReactNode } from "react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";

/** Soft tinted chips — same language as GitHub open/merged badges. */
const TINT: Record<string, string> = {
  running:
    "status-live border-emerald-500/30 bg-emerald-500/12 text-emerald-800 dark:text-emerald-300",
  queued:
    "status-hold border-amber-500/35 bg-amber-500/10 text-amber-900 dark:text-amber-200",
  waiting_review:
    "status-hold border-amber-500/35 bg-amber-500/10 text-amber-900 dark:text-amber-200",
  open: "border-green-500/35 bg-green-500/15 text-green-800 dark:text-green-400",
  finished: "border-sky-500/35 bg-sky-500/12 text-sky-800 dark:text-sky-300",
  completed: "border-teal-500/35 bg-teal-500/12 text-teal-800 dark:text-teal-300",
  merged: "border-purple-500/35 bg-purple-500/15 text-purple-800 dark:text-purple-300",
  closed: "border-red-500/30 bg-red-500/10 text-red-800 dark:text-red-400",
  failed: "border-red-500/35 bg-red-500/15 text-red-800 dark:text-red-400",
  error: "border-red-500/35 bg-red-500/15 text-red-800 dark:text-red-400",
};

const LIVE = new Set(["running"]);
const HOLD = new Set(["waiting_review", "queued"]);

function label(status: string) {
  return status.replaceAll("_", " ");
}

export function StatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const live = LIVE.has(status);
  const hold = HOLD.has(status);

  return (
    <Badge
      variant="outline"
      data-status={status}
      className={cn(
        "relative font-mono text-[0.7rem] tracking-wide uppercase",
        TINT[status] ?? "border-border bg-secondary/60 text-muted-foreground",
        className,
      )}
    >
      {live && <span className="status-live-pip" aria-hidden />}
      {hold && <span className="status-hold-pip" aria-hidden />}
      <span className="relative z-10">{label(status)}</span>
    </Badge>
  );
}

/** Soft live frame for cards/rows while work is in flight. */
export function LiveSurface({
  active,
  className,
  children,
}: {
  active: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("relative", active && "status-live-surface", className)}>
      {active && <span className="status-live-rail" aria-hidden />}
      {children}
    </div>
  );
}
