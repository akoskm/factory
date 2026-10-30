import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { runs, workItems } from "../db/schema.js";

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export async function projectMetrics(projectId: string, from: Date, to: Date) {
  const items = await db
    .select()
    .from(workItems)
    .where(
      and(
        eq(workItems.projectId, projectId),
        gte(workItems.kickoffAt, from),
        lte(workItems.kickoffAt, to),
      ),
    );

  const kickoffToPr: number[] = [];
  const prToReview: number[] = [];
  const reviewToMerge: number[] = [];
  const kickoffToMerge: number[] = [];

  for (const item of items) {
    if (item.kickoffAt && item.prOpenedAt) {
      kickoffToPr.push(item.prOpenedAt.getTime() - item.kickoffAt.getTime());
    }
    if (item.prOpenedAt && item.firstReviewAt) {
      prToReview.push(item.firstReviewAt.getTime() - item.prOpenedAt.getTime());
    }
    if (item.firstReviewAt && item.mergedAt) {
      reviewToMerge.push(item.mergedAt.getTime() - item.firstReviewAt.getTime());
    }
    if (item.kickoffAt && item.mergedAt) {
      kickoffToMerge.push(item.mergedAt.getTime() - item.kickoffAt.getTime());
    }
  }

  const opened = items.filter((i) => i.prNumber).length;
  const merged = items.filter((i) => i.mergedAt).length;

  const runRows = await db
    .select({
      agentName: runs.agentName,
      count: sql<number>`count(*)::int`,
      cost: sql<string>`coalesce(sum(${runs.costUsd}), 0)`,
    })
    .from(runs)
    .where(
      and(
        eq(runs.projectId, projectId),
        gte(runs.startedAt, from),
        lte(runs.startedAt, to),
      ),
    )
    .groupBy(runs.agentName);

  return {
    cycleTime: {
      kickoffToPrMs: median(kickoffToPr),
      prToFirstReviewMs: median(prToReview),
      firstReviewToMergeMs: median(reviewToMerge),
      kickoffToMergeMs: median(kickoffToMerge),
    },
    pullRequests: { opened, merged },
    runsByAgent: runRows,
    totalCostUsd: runRows.reduce((sum, r) => sum + Number(r.cost || 0), 0),
  };
}
