import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { WorkItem } from "./api.js";
import {
  bucketWorkPageSections,
  countInPipeline,
  countRunningSlots,
  shouldShowWorkPageStrip,
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
    error: null,
  };
}

const ALL_STATUSES = [
  "running",
  "queued",
  "waiting_review",
  "needs_user",
  "completed",
  "merged",
  "finished",
  "failed",
  "error",
] as const;

describe("countRunningSlots", () => {
  it("counts only running", () => {
    const items = [
      item("running", "a"),
      item("queued", "b"),
      item("running", "c"),
      item("completed", "d"),
    ];
    assert.equal(countRunningSlots(items), 2);
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
      item("running"),
      item("merged"),
      item("failed"),
    ];
    assert.equal(countInPipeline(items), 2);
  });
});

describe("bucketWorkPageSections", () => {
  it("partitions every known status into exactly one bucket", () => {
    const items = ALL_STATUSES.map((s) => item(s));
    const buckets = bucketWorkPageSections(items);
    const flat = [
      ...buckets.activeNow,
      ...buckets.waitingToStart,
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
      item("needs_user", "3"),
    ];
    const buckets = bucketWorkPageSections(items);
    const ids = [
      ...buckets.activeNow,
      ...buckets.waitingToStart,
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
    assert.equal(buckets.onHold.length, 0);
    assert.equal(buckets.done.length, 0);
    assert.equal(buckets.failed.length, 0);
  });
});