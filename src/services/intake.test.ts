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
    existingExternalIds: async () => new Set(),
    insertWorkItem: async () => {
      throw new Error("should not insert");
    },
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
  it("starts workflows for new labeled issues", async () => {
    const started: string[] = [];
    const inserted: string[] = [];
    const result = await runIntakePass(
      baseDeps({
        listEnabledSources: async () => [source()],
        listReadyIssues: async () => [
          { externalId: "13", title: "t", body: "", url: "https://x/13", labels: ["factory"] },
        ],
        existingExternalIds: async () => new Set(),
        insertWorkItem: async (input) => {
          inserted.push(input.externalId);
          return {
            id: "wi-1",
            projectId: input.projectId,
            sourceId: input.sourceId,
            externalId: input.externalId,
            workflowId: input.workflowId,
            status: "queued",
          };
        },
        startWorkItemWorkflow: async (input) => {
          started.push(input.externalId);
        },
      }),
    );
    assert.equal(result.started, 1);
    assert.deepEqual(inserted, ["13"]);
    assert.deepEqual(started, ["13"]);
  });

  it("skips issues that already have work items", async () => {
    const started: string[] = [];
    const result = await runIntakePass(
      baseDeps({
        listEnabledSources: async () => [source()],
        listReadyIssues: async () => [
          { externalId: "13", title: "t", body: "", url: "https://x/13", labels: ["factory"] },
        ],
        existingExternalIds: async () => new Set(["13"]),
        startWorkItemWorkflow: async (input) => {
          started.push(input.externalId);
        },
      }),
    );
    assert.equal(result.started, 0);
    assert.deepEqual(started, []);
  });

  it("repairs queued work items with absent workflow", async () => {
    const started: string[] = [];
    const result = await runIntakePass(
      baseDeps({
        listOrphanCandidates: async () => [
          {
            id: "wi-orphan",
            projectId: "proj-1",
            sourceId: "src-1",
            externalId: "99",
            workflowId: "wi-proj-src-99",
            status: "queued",
          },
        ],
        workflowPresence: async () => "absent",
        startWorkItemWorkflow: async (input) => {
          started.push(input.workItemId);
        },
      }),
    );
    assert.equal(result.repaired, 1);
    assert.deepEqual(started, ["wi-orphan"]);
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
            status: "queued",
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
            status: "queued",
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
