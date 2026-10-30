import { Badge } from "@/components/ui/badge";

const VARIANTS = {
  running: "default",
  queued: "outline",
  waiting_review: "outline",
  open: "outline",
  finished: "secondary",
  completed: "secondary",
  merged: "secondary",
  failed: "destructive",
  error: "destructive",
} as const;

export function StatusBadge({ status }: { status: string }) {
  const variant = VARIANTS[status as keyof typeof VARIANTS] ?? "secondary";
  return <Badge variant={variant}>{status.replaceAll("_", " ")}</Badge>;
}
