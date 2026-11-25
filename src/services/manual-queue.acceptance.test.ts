import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runIntakePass, type IntakeDeps, type IntakeWorkItem } from "./intake.js";
import { applyQueueAction } from "./queue-work-item.js";
import {
  runDispatcherPass,
  type DispatcherDeps,
  type DispatcherWorkItem,
} from "./queue-dispatcher.js";
import type { StartWorkflowInput } from "./start-work-item-workflow.js";

type FakeItem = {
  id: string;
  projectId: string;
  sourceId: string;
  externalId: string;
  workflowId: string;
  status: string;
  title: string;
  body: string;
  url: string;
  queuedAt: Date | null;
  scheduledFor: Date | null;
  phase?: string | null;
  currentAgent?: string | null;
  integrateAttempts?: number;
  revisionLoops?: number;
  error?: string | null;
};

describe("manual work queue acceptance", () => {
  it("lists only → queue/schedule → dispatcher under cap", async () => {
    const started: string[] = [];
    let now = new Date("2026-06-01T10:00:00Z");
    const store = new Map<string, FakeItem>();

    function issues(titleA = "Issue A") {
      return [
        { externalId: "A", title: titleA, body: "", url: "https://gh/A", labels: ["factory"] },
        { externalId: "B", title: "Issue B", body: "", url: "https://gh/B", labels: ["factory"] },
        { externalId: "C", title: "Issue C", body: "", url: "https://gh/C", labels: ["factory"] },
      ];
    }

    const intakeDeps = (ready = issues()): IntakeDeps => ({
      listEnabledSources: async () => [
        { id: "src-1", projectId: "proj-1", kind: "github" },
      ],
      listReadyIssues: async () => ready,
      existingByExternalId: async () => {
        const m = new Map<string, { id: string; status: string }>();
        for (const item of store.values()) {
          m.set(item.externalId, { id: item.id, status: item.status });
        }
        return m;
      },
      insertWorkItem: async (input) => {
        const row: FakeItem = {
          id: `wi-${input.externalId}`,
          projectId: input.projectId,
          sourceId: input.sourceId,
          externalId: input.externalId,
          workflowId: input.workflowId,
          status: "listed",
          title: input.title,
          body: input.body,
          url: input.url,
          queuedAt: null,
          scheduledFor: null,
        };
        store.set(input.externalId, row);
        return row as IntakeWorkItem;
      },
      refreshListedWorkItem: async (id, fields) => {
        for (const item of store.values()) {
          if (item.id === id && item.status === "listed") {
            item.title = fields.title;
            item.body = fields.body;
            item.url = fields.url;
          }
        }
      },
      listOrphanCandidates: async () =>
        [...store.values()].filter((i) =>
          ["running", "waiting_review", "needs_user", "merged"].includes(i.status),
        ),
      workflowPresence: async () => "absent",
      startWorkItemWorkflow: async (input: StartWorkflowInput) => {
        started.push(input.workItemId);
      },
    });

    const dispatcherDeps = (): DispatcherDeps => ({
      now: () => now,
      listProjects: async () => [{ id: "proj-1", maxConcurrentRuns: 1 }],
      promoteDueScheduled: async (clock) => {
        let n = 0;
        for (const item of store.values()) {
          if (
            item.status === "scheduled" &&
            item.scheduledFor &&
            item.scheduledFor.getTime() <= clock.getTime()
          ) {
            item.status = "queued";
            item.queuedAt = clock;
            item.scheduledFor = null;
            n += 1;
          }
        }
        return n;
      },
      countActive: async () =>
        [...store.values()].filter((i) =>
          ["running", "waiting_review", "needs_user"].includes(i.status),
        ).length,
      listQueued: async () =>
        [...store.values()]
          .filter((i) => i.status === "queued")
          .sort(
            (a, b) =>
              (a.queuedAt?.getTime() ?? 0) - (b.queuedAt?.getTime() ?? 0) ||
              a.id.localeCompare(b.id),
          ) as DispatcherWorkItem[],
      startWorkItemWorkflow: async (input) => {
        started.push(input.workItemId);
        const item = [...store.values()].find((i) => i.id === input.workItemId);
        if (item) item.status = "running";
      },
    });

    // 1. Intake lists A,B,C — no starts
    const pass1 = await runIntakePass(intakeDeps());
    assert.equal(pass1.listed, 3);
    assert.deepEqual(
      [...store.values()].map((i) => i.status),
      ["listed", "listed", "listed"],
    );
    assert.deepEqual(started, []);

    // 2. Re-intake refreshes title, still no starts
    const pass2 = await runIntakePass(intakeDeps(issues("Issue A v2")));
    assert.equal(pass2.listed, 0);
    assert.equal(store.get("A")!.title, "Issue A v2");
    assert.deepEqual(started, []);

    // 3. Queue A
    Object.assign(store.get("A")!, applyQueueAction(store.get("A")!, { mode: "queue" }, now));
    assert.equal(store.get("A")!.status, "queued");
    assert.ok(store.get("A")!.queuedAt);
    assert.deepEqual(started, []);

    // 4. Schedule B for +1h
    Object.assign(
      store.get("B")!,
      applyQueueAction(
        store.get("B")!,
        { mode: "schedule", scheduledFor: new Date(now.getTime() + 3_600_000) },
        now,
      ),
    );
    assert.equal(store.get("B")!.status, "scheduled");
    assert.deepEqual(started, []);

    // 5. queue C then dispatch → starts A (FIFO), C stays queued
    Object.assign(
      store.get("C")!,
      applyQueueAction(store.get("C")!, { mode: "queue" }, new Date(now.getTime() + 1000)),
    );
    const disp1 = await runDispatcherPass(dispatcherDeps());
    assert.equal(disp1.started, 1);
    assert.deepEqual(started, ["wi-A"]);
    assert.equal(store.get("A")!.status, "running");
    assert.equal(store.get("C")!.status, "queued");

    // 6. Cap full — no new start
    const disp2 = await runDispatcherPass(dispatcherDeps());
    assert.equal(disp2.started, 0);
    assert.deepEqual(started, ["wi-A"]);

    // 7. Complete A; advance clock past B schedule; dispatch
    // C was queued earlier than B's promote → FIFO starts C; B stays queued
    store.get("A")!.status = "completed";
    now = new Date(now.getTime() + 3_600_000 + 1000);
    const disp3 = await runDispatcherPass(dispatcherDeps());
    assert.equal(disp3.promoted, 1);
    assert.equal(disp3.started, 1);
    assert.equal(store.get("C")!.status, "running");
    assert.equal(store.get("B")!.status, "queued");
    assert.deepEqual(started, ["wi-A", "wi-C"]);

    // 8. Orphan repair never starts queued/listed
    const repairStarts: string[] = [];
    const repairPass = await runIntakePass({
      ...intakeDeps(),
      listOrphanCandidates: async () => [
        {
          id: "wi-C",
          projectId: "proj-1",
          sourceId: "src-1",
          externalId: "C",
          workflowId: "w-c",
          status: "queued",
        },
        {
          id: "wi-ghost",
          projectId: "proj-1",
          sourceId: "src-1",
          externalId: "X",
          workflowId: "w-x",
          status: "listed",
        },
      ],
      startWorkItemWorkflow: async (input) => {
        repairStarts.push(input.workItemId);
      },
    });
    assert.equal(repairPass.repaired, 0);
    assert.deepEqual(repairStarts, []);
  });
});
