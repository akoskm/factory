import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { WorkItem } from "./api.js";
import {
  bucketWorkPageSections,
  countInPipeline,
  countRunningSlots,
  countRunningWorkItems,
  shouldShowWorkPageStrip,
  workPageCapacityBaseText,
} from "./work-page-counts.js";

function item(status: string, id?: string): WorkItem {
  return {
    id: id ?? status,
    title: status,
    status,
    currentAgent: null,
    waitingForReview: false,
    url: "",
    prUrl: null,
    workflowId: "wf",
    kickoffAt: "2026-01-01T00:00:00.000Z",
    queuedAt: null,
    scheduledFor: null,
    error: null,
  };
}

const ALL_STATUSES = [
  "running",
  "queued",
  "scheduled",
  "listed",
  "waiting_review",
  "needs_user",
  "completed",
  "merged",
  "finished",
  "failed",
  "error",
] as const;

describe("countRunningWorkItems", () => {
  it("counts only status running", () => {
    const items = [item("running", "a"), item("needs_user", "b"), item("waiting_review", "c")];
    assert.equal(countRunningWorkItems(items), 1);
  });
});

describe("workPageCapacityBaseText", () => {
  it("idle done-only: slots text without running fragment", () => {
    const items = [item("merged"), item("completed")];
    const cap = 1;
    assert.equal(
      workPageCapacityBaseText(countRunningSlots(items), cap, countRunningWorkItems(items)),
      "0 of 1 slots in use",
    );
  });

  it("hold-only at cap: no running fragment", () => {
    const items = [item("needs_user", "a")];
    const cap = 1;
    assert.equal(
      workPageCapacityBaseText(countRunningSlots(items), cap, countRunningWorkItems(items)),
      "1 of 1 slots in use",
    );
  });

  it("one running: includes running fragment", () => {
    const items = [item("running", "a")];
    const cap = 1;
    assert.equal(
      workPageCapacityBaseText(countRunningSlots(items), cap, countRunningWorkItems(items)),
      "1 of 1 slots in use · 1 running",
    );
  });

  it("empty list: still shows 0 of cap", () => {
    assert.equal(workPageCapacityBaseText(0, 2, 0), "0 of 2 slots in use");
  });
});

describe("countRunningSlots", () => {
  it("counts running plus holds that consume a slot", () => {
    const items = [
      item("running", "a"),
      item("queued", "b"),
      item("needs_user", "c"),
      item("waiting_review", "d"),
      item("completed", "e"),
    ];
    assert.equal(countRunningSlots(items), 3);
  });
});

describe("shouldShowWorkPageStrip", () => {
  it("hides when all terminal and no slots in use", () => {
    const items = [item("merged"), item("completed"), item("finished")];
    assert.equal(countRunningSlots(items), 0);
    assert.equal(shouldShowWorkPageStrip(items, 0), false);
  });

  it("shows when done plus queued even if inUse is 0", () => {
    const items = [item("merged"), item("queued", "q")];
    assert.equal(shouldShowWorkPageStrip(items, 0), true);
    assert.equal(countRunningSlots(items), 0);
  });

  it("hides when there are no work items", () => {
    assert.equal(shouldShowWorkPageStrip([], 0), false);
  });

  it("shows when inUse > 0", () => {
    const items = [item("merged")];
    assert.equal(shouldShowWorkPageStrip(items, 1), true);
  });
});

describe("countInPipeline", () => {
  it("excludes terminal statuses", () => {
    const items = [
      item("queued"),
      item("listed"),
      item("running"),
      item("merged"),
      item("failed"),
    ];
    assert.equal(countInPipeline(items), 3);
  });
});

describe("bucketWorkPageSections", () => {
  it("partitions every known status into exactly one bucket", () => {
    const items = ALL_STATUSES.map((s) => item(s));
    const buckets = bucketWorkPageSections(items);
    const flat = [
      ...buckets.activeNow,
      ...buckets.waitingToStart,
      ...buckets.tasks,
      ...buckets.onHold,
      ...buckets.done,
      ...buckets.failed,
    ];
    assert.equal(flat.length, items.length);
    assert.deepEqual(
      flat.map((i) => i.status).sort(),
      [...ALL_STATUSES].sort(),
    );
  });

  it("has no duplicate assignments", () => {
    const items = [
      item("running", "1"),
      item("queued", "2"),
      item("listed", "3"),
      item("needs_user", "4"),
    ];
    const buckets = bucketWorkPageSections(items);
    const ids = [
      ...buckets.activeNow,
      ...buckets.waitingToStart,
      ...buckets.tasks,
      ...buckets.onHold,
      ...buckets.done,
      ...buckets.failed,
    ].map((i) => i.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("single running item lands in activeNow only", () => {
    const buckets = bucketWorkPageSections([item("running")]);
    assert.equal(buckets.activeNow.length, 1);
    assert.equal(buckets.waitingToStart.length, 0);
    assert.equal(buckets.tasks.length, 0);
    assert.equal(buckets.onHold.length, 0);
    assert.equal(buckets.done.length, 0);
    assert.equal(buckets.failed.length, 0);
  });
});
