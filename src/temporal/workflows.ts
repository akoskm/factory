import {
  condition,
  defineSignal,
  proxyActivities,
  setHandler,
  sleep,
} from "@temporalio/workflow";
import type * as activities from "./activities.js";
import type { ReviewSignal, WorkItemWorkflowInput } from "./shared.js";

const {
  runAgentActivity,
  updateWorkItemStatus,
  mergePullRequest,
  syncPrTimestamps,
  getAgentWaitSetting,
  canSpawn,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: "60 minutes",
  retry: {
    maximumAttempts: 3,
    nonRetryableErrorTypes: [],
  },
});

export const reviewSignal = defineSignal<[ReviewSignal]>("review");

function summarizePrior(
  agentName: string,
  result: {
    decision?: { action: string; agent?: string; note?: string } | null;
    reviewVerdict?: string;
    verifyVerdict?: string;
    transcript: string;
  },
): string {
  if (result.decision) {
    const d = result.decision;
    return `### ${agentName}\n${d.action}${d.agent ? ` → ${d.agent}` : ""}${d.note ? `: ${d.note}` : ""}`;
  }
  if (result.reviewVerdict) return `### ${agentName}\nreview: ${result.reviewVerdict}`;
  if (result.verifyVerdict) return `### ${agentName}\nverify: ${result.verifyVerdict}`;
  const snippet = result.transcript.replace(/\s+/g, " ").trim().slice(0, 280);
  return `### ${agentName}\n${snippet || "(no summary)"}`;
}

export async function workItemWorkflow(input: WorkItemWorkflowInput): Promise<void> {
  const reviewState: { pending: ReviewSignal | null } = { pending: null };
  setHandler(reviewSignal, (sig) => {
    reviewState.pending = sig;
  });

  const prior: string[] = [];
  let revisionLoops = 0;
  let nextAgent = "foreman";
  let humanNote: string | undefined;

  await updateWorkItemStatus({
    workItemId: input.workItemId,
    status: "running",
    currentAgent: "foreman",
  });

  for (let step = 0; step < 40; step++) {
    const result = await runAgentActivity({
      workItemId: input.workItemId,
      projectId: input.projectId,
      sourceId: input.sourceId,
      agentName: nextAgent,
      priorTranscripts: prior.slice(-3),
      humanNote,
    });
    humanNote = undefined;

    if (result.status === "error") {
      await updateWorkItemStatus({
        workItemId: input.workItemId,
        status: "failed",
        error: result.error ?? "agent error",
        currentAgent: nextAgent,
      });
      return;
    }

    prior.push(summarizePrior(nextAgent, result));

    const wait = await getAgentWaitSetting({
      projectId: input.projectId,
      agentName: nextAgent,
    });
    if (wait) {
      reviewState.pending = null;
      await updateWorkItemStatus({
        workItemId: input.workItemId,
        status: "waiting_review",
        currentAgent: nextAgent,
        waitingForReview: true,
      });
      const got = await condition(() => reviewState.pending !== null, "7 days");
      const signal = reviewState.pending as ReviewSignal | null;
      if (!got || !signal) {
        await updateWorkItemStatus({
          workItemId: input.workItemId,
          status: "failed",
          error: "review wait timed out",
          waitingForReview: false,
        });
        return;
      }
      if (signal.decision === "request_changes") {
        humanNote = signal.note ?? "Please revise.";
        reviewState.pending = null;
        await updateWorkItemStatus({
          workItemId: input.workItemId,
          status: "running",
          waitingForReview: false,
        });
        continue;
      }
      reviewState.pending = null;
      await updateWorkItemStatus({
        workItemId: input.workItemId,
        status: "running",
        waitingForReview: false,
      });
    }

    if (nextAgent === "foreman") {
      const decision = result.decision;
      if (!decision || decision.action === "fail") {
        await updateWorkItemStatus({
          workItemId: input.workItemId,
          status: "failed",
          error: decision?.note ?? "foreman failed",
        });
        return;
      }
      if (decision.action === "complete") {
        try {
          await mergePullRequest({
            workItemId: input.workItemId,
            sourceId: input.sourceId,
          });
        } catch (err) {
          await updateWorkItemStatus({
            workItemId: input.workItemId,
            status: "failed",
            error: err instanceof Error ? err.message : String(err),
          });
          return;
        }
        await syncPrTimestamps({
          workItemId: input.workItemId,
          sourceId: input.sourceId,
        });
        const monitor = await runAgentActivity({
          workItemId: input.workItemId,
          projectId: input.projectId,
          sourceId: input.sourceId,
          agentName: "monitor",
          priorTranscripts: prior.slice(-3),
        });
        prior.push(summarizePrior("monitor", monitor));
        await updateWorkItemStatus({
          workItemId: input.workItemId,
          status: "completed",
          currentAgent: "monitor",
          completedAt: new Date().toISOString(),
        });
        return;
      }
      if (decision.action === "spawn" && decision.agent) {
        const ok = await canSpawn({
          projectId: input.projectId,
          parentAgent: "foreman",
          childAgent: decision.agent,
        });
        if (!ok) {
          await updateWorkItemStatus({
            workItemId: input.workItemId,
            status: "failed",
            error: `cannot spawn ${decision.agent}`,
          });
          return;
        }
        nextAgent = decision.agent;
        continue;
      }
    }

    if (nextAgent === "review") {
      if (result.reviewVerdict === "revise" && revisionLoops < 2) {
        revisionLoops += 1;
        nextAgent = "implement";
        continue;
      }
      nextAgent = "foreman";
      continue;
    }

    if (nextAgent === "verify") {
      if (result.verifyVerdict === "fail") {
        await updateWorkItemStatus({
          workItemId: input.workItemId,
          status: "failed",
          error: "verify failed",
        });
        return;
      }
      nextAgent = "foreman";
      continue;
    }

    // After specialist agents, return to foreman
    nextAgent = "foreman";
  }

  await updateWorkItemStatus({
    workItemId: input.workItemId,
    status: "failed",
    error: "exceeded max workflow steps",
  });
}

export async function intakeWorkflow(): Promise<{ started: number }> {
  const { pollIntake } = proxyActivities<typeof activities>({
    startToCloseTimeout: "2 minutes",
    retry: { maximumAttempts: 2 },
  });
  return pollIntake();
}

/** Keep the schedule worker alive between ticks. */
export async function idleWorkflow(): Promise<void> {
  await sleep("1 second");
}
