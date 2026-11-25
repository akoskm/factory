import type { WorkItem } from "./api";

/** Statuses that consume a concurrency slot (matches queue-dispatcher). */
export const ACTIVE_SLOT_STATUSES = new Set([
  "running",
  "waiting_review",
  "needs_user",
]);

export const TERMINAL_STATUSES = new Set([
  "completed",
  "merged",
  "finished",
  "failed",
  "error",
]);

export function isTerminalWorkItemStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function countRunningSlots(items: WorkItem[]): number {
  return items.filter((i) => ACTIVE_SLOT_STATUSES.has(i.status)).length;
}

export function countInPipeline(items: WorkItem[]): number {
  return items.filter((i) => !isTerminalWorkItemStatus(i.status)).length;
}

export type WorkPageSections = {
  activeNow: WorkItem[];
  waitingToStart: WorkItem[];
  tasks: WorkItem[];
  onHold: WorkItem[];
  done: WorkItem[];
  failed: WorkItem[];
};

function sectionKey(status: string): keyof WorkPageSections {
  if (ACTIVE_SLOT_STATUSES.has(status)) return "activeNow";
  if (status === "queued" || status === "scheduled") return "waitingToStart";
  if (status === "listed") return "tasks";
  if (status === "completed" || status === "merged" || status === "finished") return "done";
  if (status === "failed" || status === "error") return "failed";
  if (isTerminalWorkItemStatus(status)) return "failed";
  return "onHold";
}

export function bucketWorkPageSections(items: WorkItem[]): WorkPageSections {
  const sections: WorkPageSections = {
    activeNow: [],
    waitingToStart: [],
    tasks: [],
    onHold: [],
    done: [],
    failed: [],
  };
  for (const item of items) {
    sections[sectionKey(item.status)].push(item);
  }
  return sections;
}

/** Strip hidden when no rows, or factory idle with only terminal items. */
export function shouldShowWorkPageStrip(items: WorkItem[], inUse: number): boolean {
  if (items.length === 0) return false;
  if (inUse > 0) return true;
  return items.some((i) => !isTerminalWorkItemStatus(i.status));
}
