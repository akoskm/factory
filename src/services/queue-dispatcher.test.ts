import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  runDispatcherPass,
  type DispatcherDeps,
  type DispatcherWorkItem,
} from "./queue-dispatcher.js";

function item(partial: Partial<DispatcherWorkItem> & { id: string }): DispatcherWorkItem {
  return {
    projectId: "proj-1",
    sourceId: "src-1",
    externalId: partial.id,
    workflowId: `wi-${partial.id}`,
    status: "queued",
    queuedAt: new Date("2026-01-01T00:00:00Z"),
    scheduledFor: null,
    ...partial,
  };
}

function baseDeps(overrides: Partial<DispatcherDeps>): DispatcherDeps {
  return {
    now: () => new Date("2026-01-01T12:00:00Z"),
    listProjects: async () => [{ id: "proj-1", maxConcurrentRuns: 1 }],
    promoteDueScheduled: async () => 0,
    countActive: async () => 0,
    listQueued: async () => [],
    startWorkItemWorkflow: async () => {},
    ...overrides,
  };
}

describe("runDispatcherPass", () => {
  it("starts queued items FIFO up to maxConcurrentRuns", async () => {
    const started: string[] = [];
    const queued = [
      item({ id: "a", queuedAt: new Date("2026-01-01T00:00:01Z") }),
      item({ id: "b", queuedAt: new Date("2026-01-01T00:00:02Z") }),
    ];
    const result = await runDispatcherPass(
      baseDeps({
        listProjects: async () => [{ id: "proj-1", maxConcurrentRuns: 1 }],
        listQueued: async () => queued,
        startWorkItemWorkflow: async (input) => {
          started.push(input.workItemId);
          assert.equal(input.markDispatched, true);
        },
      }),
    );
    assert.equal(result.started, 1);
    assert.deepEqual(started, ["a"]);
  });

  it("skips start when at capacity", async () => {
    const started: string[] = [];
    const result = await runDispatcherPass(
      baseDeps({
        countActive: async () => 1,
        listQueued: async () => [item({ id: "a" })],
        startWorkItemWorkflow: async (input) => {
          started.push(input.workItemId);
        },
      }),
    );
    assert.equal(result.started, 0);
    assert.deepEqual(started, []);
  });

  it("promotes due scheduled before starting", async () => {
    let promotedAt: Date | null = null;
    const result = await runDispatcherPass(
      baseDeps({
        now: () => new Date("2026-01-01T12:00:00Z"),
        promoteDueScheduled: async (now) => {
          promotedAt = now;
          return 2;
        },
      }),
    );
    assert.equal(result.promoted, 2);
    assert.ok(promotedAt);
  });
});
