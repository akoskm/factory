import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseIntakeIntervalMs,
  runIntakePass,
  type IntakeDeps,
  type IntakeSource,
  type WorkflowPresence,
} from "./intake.js";

function source(partial?: Partial<IntakeSource>): IntakeSource {
  return {
    id: "src-1",
    projectId: "proj-1",
    kind: "github",
    ...partial,
  };
}

function baseDeps(overrides: Partial<IntakeDeps>): IntakeDeps {
  return {
    listEnabledSources: async () => [],
    listReadyIssues: async () => [],
    existingByExternalId: async () => new Map(),
    insertWorkItem: async () => {
      throw new Error("should not insert");
    },
    refreshListedWorkItem: async () => {},
    listOrphanCandidates: async () => [],
    workflowPresence: async () => "absent",
    startWorkItemWorkflow: async () => {},
    ...overrides,
  };
}

describe("parseIntakeIntervalMs", () => {
  it("defaults and rejects invalid values", () => {
    assert.equal(parseIntakeIntervalMs(undefined), 30_000);
    assert.equal(parseIntakeIntervalMs(""), 30_000);
    assert.equal(parseIntakeIntervalMs("abc"), 30_000);
    assert.equal(parseIntakeIntervalMs("0"), 30_000);
    assert.equal(parseIntakeIntervalMs("-5"), 30_000);
    assert.equal(parseIntakeIntervalMs("15000"), 15_000);
  });
});

describe("runIntakePass", () => {
  it("lists new labeled issues without starting workflows", async () => {
    const started: string[] = [];
    const inserted: { externalId: string; status: string }[] = [];
    const result = await runIntakePass(
      baseDeps({
        listEnabledSources: async () => [source()],
        listReadyIssues: async () => [
          { externalId: "13", title: "t", body: "", url: "https://x/13", labels: ["factory"] },
        ],
        existingByExternalId: async () => new Map(),
        insertWorkItem: async (input) => {
          inserted.push({ externalId: input.externalId, status: "listed" });
          return {
            id: "wi-1",
            projectId: input.projectId,
            sourceId: input.sourceId,
            externalId: input.externalId,
            workflowId: input.workflowId,
            status: "listed",
          };
        },
        startWorkItemWorkflow: async (input) => {
          started.push(input.externalId);
        },
      }),
    );
    assert.equal(result.listed, 1);
    assert.equal(result.repaired, 0);
    assert.deepEqual(inserted, [{ externalId: "13", status: "listed" }]);
    assert.deepEqual(started, []);
  });

  it("refreshes title/body/url for existing listed items", async () => {
    const refreshed: { id: string; title: string }[] = [];
    const result = await runIntakePass(
      baseDeps({
        listEnabledSources: async () => [source()],
        listReadyIssues: async () => [
          {
            externalId: "13",
            title: "updated",
            body: "b",
            url: "https://x/13",
            labels: ["factory"],
          },
        ],
        existingByExternalId: async () =>
          new Map([["13", { id: "wi-1", status: "listed" }]]),
        refreshListedWorkItem: async (id, fields) => {
          refreshed.push({ id, title: fields.title });
        },
      }),
    );
    assert.equal(result.listed, 0);
    assert.deepEqual(refreshed, [{ id: "wi-1", title: "updated" }]);
  });

  it("skips insert for non-listed existing work items", async () => {
    let inserts = 0;
    let refreshes = 0;
    await runIntakePass(
      baseDeps({
        listEnabledSources: async () => [source()],
        listReadyIssues: async () => [
          { externalId: "13", title: "t", body: "", url: "https://x/13", labels: ["factory"] },
        ],
        existingByExternalId: async () =>
          new Map([["13", { id: "wi-1", status: "queued" }]]),
        insertWorkItem: async () => {
          inserts += 1;
          throw new Error("no");
        },
        refreshListedWorkItem: async () => {
          refreshes += 1;
        },
      }),
    );
    assert.equal(inserts, 0);
    assert.equal(refreshes, 0);
  });

  it("does not repair listed/scheduled/queued orphans", async () => {
    const started: string[] = [];
    const result = await runIntakePass(
      baseDeps({
        listOrphanCandidates: async () => [
          {
            id: "wi-listed",
            projectId: "proj-1",
            sourceId: "src-1",
            externalId: "1",
            workflowId: "w1",
            status: "listed",
          },
          {
            id: "wi-sched",
            projectId: "proj-1",
            sourceId: "src-1",
            externalId: "2",
            workflowId: "w2",
            status: "scheduled",
          },
          {
            id: "wi-queued",
            projectId: "proj-1",
            sourceId: "src-1",
            externalId: "3",
            workflowId: "w3",
            status: "queued",
          },
        ],
        workflowPresence: async () => "absent",
        startWorkItemWorkflow: async (input) => {
          started.push(input.workItemId);
        },
      }),
    );
    assert.equal(result.repaired, 0);
    assert.deepEqual(started, []);
  });

  it("restarts a dead ship at the stored phase", async () => {
    const started: { id: string; startAgent?: string; phase?: string }[] = [];
    await runIntakePass(
      baseDeps({
        listOrphanCandidates: async () => [
          {
            id: "wi-ship",
            projectId: "proj-1",
            sourceId: "src-1",
            externalId: "7",
            workflowId: "wi-proj-src-7",
            status: "running",
            phase: "ship",
            currentAgent: "implement",
          },
        ],
        workflowPresence: async () => "absent",
        startWorkItemWorkflow: async (input) => {
          started.push({ id: input.workItemId, startAgent: input.startAgent, phase: input.phase });
        },
      }),
    );
    assert.deepEqual(started, [{ id: "wi-ship", startAgent: "ship", phase: "ship" }]);
  });

  it("restarts a dead hold with hold set", async () => {
    const started: { hold?: string; startAgent?: string }[] = [];
    await runIntakePass(
      baseDeps({
        listOrphanCandidates: async () => [
          {
            id: "wi-hold",
            projectId: "proj-1",
            sourceId: "src-1",
            externalId: "8",
            workflowId: "wi-proj-src-8",
            status: "needs_user",
            phase: "ship",
            error: "GitHub is blocking the merge",
          },
        ],
        workflowPresence: async () => "absent",
        startWorkItemWorkflow: async (input) => {
          started.push({ hold: input.hold, startAgent: input.startAgent });
        },
      }),
    );
    assert.deepEqual(started, [{ hold: "needs_user", startAgent: "ship" }]);
  });

  it("repairs running work items whose workflow is terminal", async () => {
    const started: string[] = [];
    const result = await runIntakePass(
      baseDeps({
        listOrphanCandidates: async () => [
          {
            id: "wi-stuck",
            projectId: "proj-1",
            sourceId: "src-1",
            externalId: "99",
            workflowId: "wi-proj-src-99",
            status: "running",
          },
        ],
        workflowPresence: async () => "terminal",
        startWorkItemWorkflow: async (input) => {
          started.push(input.workItemId);
        },
      }),
    );
    assert.equal(result.repaired, 1);
    assert.deepEqual(started, ["wi-stuck"]);
  });

  it("does not re-start when workflow is running", async () => {
    const started: string[] = [];
    const result = await runIntakePass(
      baseDeps({
        listOrphanCandidates: async () => [
          {
            id: "wi-alive",
            projectId: "proj-1",
            sourceId: "src-1",
            externalId: "99",
            workflowId: "wi-proj-src-99",
            status: "running",
          },
        ],
        workflowPresence: async () => "running",
        startWorkItemWorkflow: async (input) => {
          started.push(input.workItemId);
        },
      }),
    );
    assert.equal(result.repaired, 0);
    assert.deepEqual(started, []);
  });

  it("skips repair when workflow presence is unknown", async () => {
    const started: string[] = [];
    const presence: WorkflowPresence = "unknown";
    const result = await runIntakePass(
      baseDeps({
        listOrphanCandidates: async () => [
          {
            id: "wi-maybe",
            projectId: "proj-1",
            sourceId: "src-1",
            externalId: "99",
            workflowId: "wi-proj-src-99",
            status: "running",
          },
        ],
        workflowPresence: async () => presence,
        startWorkItemWorkflow: async (input) => {
          started.push(input.workItemId);
        },
      }),
    );
    assert.equal(result.repaired, 0);
    assert.deepEqual(started, []);
  });
});
