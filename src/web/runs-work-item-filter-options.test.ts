import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { WorkItem } from "./api";
import {
  buildRunsWorkItemFilterOptions,
  filterRunsWorkItemOptions,
  runsWorkItemFilterOptionSearchText,
} from "./runs-work-item-filter-options";

describe("buildRunsWorkItemFilterOptions", () => {
  it("includes All runs and distinct work items sorted by title", () => {
    const workItems: WorkItem[] = [
      {
        id: "b",
        title: "Beta task",
        status: "done",
        currentAgent: null,
        waitingForReview: false,
        url: "https://github.com/o/r/issues/42",
        prUrl: null,
        workflowId: "w",
        kickoffAt: "",
        error: null,
      },
      {
        id: "a",
        title: "Alpha task",
        status: "done",
        currentAgent: null,
        waitingForReview: false,
        url: "",
        prUrl: null,
        workflowId: "w",
        kickoffAt: "",
        error: null,
      },
    ];
    const options = buildRunsWorkItemFilterOptions(
      [{ workItemId: "b" }, { workItemId: "a" }, { workItemId: "b" }],
      workItems,
    );
    assert.equal(options[0]?.isAll, true);
    assert.equal(options[1]?.id, "a");
    assert.equal(options[2]?.id, "b");
  });

  it("falls back for orphan work item ids", () => {
    const options = buildRunsWorkItemFilterOptions(
      [{ workItemId: "orphan-id-12345678" }],
      [],
    );
    assert.match(options[1]?.title ?? "", /^Work item orphan-i/);
  });
});

describe("filterRunsWorkItemOptions", () => {
  it("matches title, issue label, and issue number", () => {
    const option = {
      id: "x",
      title: "Fix login",
      url: "https://github.com/o/r/issues/7",
      sortKey: "Fix login",
    };
    assert.equal(filterRunsWorkItemOptions(option, "login"), true);
    assert.equal(filterRunsWorkItemOptions(option, "7"), true);
    assert.equal(filterRunsWorkItemOptions(option, "#7"), true);
    assert.equal(filterRunsWorkItemOptions(option, "issue #7"), true);
    assert.equal(filterRunsWorkItemOptions(option, "missing"), false);
    assert.equal(
      runsWorkItemFilterOptionSearchText({ id: "", title: "All runs", url: null, sortKey: "", isAll: true }),
      "all runs",
    );
  });
});
