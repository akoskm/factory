import type { ReactNode } from "react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";

const VARIANTS = {
  running: "default",
  queued: "outline",
  waiting_review: "outline",
  needs_user: "outline",
  open: "outline",
  finished: "secondary",
  completed: "secondary",
  merged: "secondary",
  closed: "secondary",
  failed: "destructive",
  error: "destructive",
} as const;

const LIVE = new Set(["running"]);
const HOLD = new Set(["waiting_review", "needs_user", "queued"]);

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
  const variant = VARIANTS[status as keyof typeof VARIANTS] ?? "secondary";
  const live = LIVE.has(status);
  const hold = HOLD.has(status);

  return (
    <Badge
      variant={variant}
      data-status={status}
      className={cn(
        "relative font-mono text-[0.7rem] tracking-wide uppercase",
        live &&
          "status-live border-emerald-500/30 bg-emerald-500/12 text-emerald-800 dark:text-emerald-300",
        hold &&
          "status-hold border-amber-500/35 bg-amber-500/10 text-amber-900 dark:text-amber-200",
        status === "failed" || status === "error"
          ? "font-mono uppercase tracking-wide"
          : null,
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
