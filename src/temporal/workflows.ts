import {
  condition,
  defineSignal,
  proxyActivities,
  setHandler,
} from "@temporalio/workflow";
import type * as activities from "./activities.js";
import type { LearnWorkflowInput, ReviewSignal, WorkItemWorkflowInput } from "./shared.js";
import { planOnComplete } from "./complete.js";
import { nextShipStep } from "./ship.js";
import { nextStep } from "./pipeline.js";
import type { PipelineConfig } from "../config/load.js";

const {
  runAgentActivity,
  updateWorkItemStatus,
  mergePullRequest,
  getPullRequestMergeGate,
  closeSourceIssue,
  syncPrTimestamps,
  getAgentWaitSetting,
  canSpawn,
  pinConfigSha,
  latestConfigSha,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: "60 minutes",
  retry: {
    maximumAttempts: 3,
    nonRetryableErrorTypes: [],
  },
});

export const reviewSignal = defineSignal<[ReviewSignal]>("review");

function activityMessage(err: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = err;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error && current.message) parts.push(current.message);
    current = "cause" in current ? (current as { cause?: unknown }).cause : undefined;
  }
  return parts.find((part) => part !== "Activity task failed") ?? parts[0] ?? "activity failed";
}

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
  let integrating = false;
  let integrateAttempts = 0;
  let pendingShip = input.startAgent === "ship";
  let humanNote: string | undefined;

  const pinned = await pinConfigSha({
    workItemId: input.workItemId,
    sourceId: input.sourceId,
  });
  const pipeline: PipelineConfig = pinned.pipeline;
  const configSha = pinned.configSha;
  let nextAgent = pendingShip
    ? "implement"
    : input.startAgent?.trim() || pipeline.startAgent || "foreman";

  async function pauseForUser(note: string): Promise<"continue" | "stop"> {
    reviewState.pending = null;
    await updateWorkItemStatus({
      workItemId: input.workItemId,
      status: "waiting_review",
      currentAgent: "implement",
      waitingForReview: true,
      error: note,
    });
    const got = await condition(() => reviewState.pending !== null, "7 days");
    const signal = reviewState.pending as ReviewSignal | null;
    reviewState.pending = null;
    if (!got || !signal || signal.decision === "request_changes") {
      await updateWorkItemStatus({
        workItemId: input.workItemId,
        status: "failed",
        waitingForReview: false,
        error: signal?.decision === "request_changes" ? signal.note || note : note,
      });
      return "stop";
    }
    await updateWorkItemStatus({
      workItemId: input.workItemId,
      status: "running",
      waitingForReview: false,
      error: null,
    });
    return "continue";
  }

  async function finishMerged(): Promise<void> {
    await syncPrTimestamps({
      workItemId: input.workItemId,
      sourceId: input.sourceId,
    });
    let currentAgent: string | null = null;
    for (const action of planOnComplete(pipeline.onComplete)) {
      if (action.kind === "skip") continue;
      if (action.kind === "closeIssue") {
        try {
          await closeSourceIssue({
            workItemId: input.workItemId,
            sourceId: input.sourceId,
          });
        } catch (err) {
          await updateWorkItemStatus({
            workItemId: input.workItemId,
            status: "failed",
            error: activityMessage(err),
          });
          return;
        }
        continue;
      }
      const agent = await runAgentActivity({
        workItemId: input.workItemId,
        projectId: input.projectId,
        sourceId: input.sourceId,
        agentName: action.name,
        priorTranscripts: prior.slice(-3),
        configSha,
      });
      prior.push(summarizePrior(action.name, agent));
      currentAgent = action.name;
    }
    await updateWorkItemStatus({
      workItemId: input.workItemId,
      status: "completed",
      ...(currentAgent ? { currentAgent } : {}),
      completedAt: new Date().toISOString(),
    });
  }

  /** Merge when the PR is up to date. Otherwise send implement at the branch, once. */
  async function shipOrContinue(): Promise<"done" | "stopped" | "continue"> {
    let gate;
    try {
      gate = await getPullRequestMergeGate({
        workItemId: input.workItemId,
        sourceId: input.sourceId,
      });
    } catch (err) {
      if ((await pauseForUser(activityMessage(err))) === "stop") return "stopped";
      return shipOrContinue();
    }
    const step = nextShipStep(gate, integrateAttempts);
    if (step.action === "integrate") {
      integrateAttempts += 1;
      integrating = true;
      humanNote = step.note;
      nextAgent = "implement";
      await updateWorkItemStatus({
        workItemId: input.workItemId,
        status: "running",
        currentAgent: "implement",
        waitingForReview: false,
        error: null,
      });
      return "continue";
    }
    if (step.action === "ask_user") {
      if ((await pauseForUser(step.note)) === "stop") return "stopped";
      return shipOrContinue();
    }
    try {
      await mergePullRequest({
        workItemId: input.workItemId,
        sourceId: input.sourceId,
      });
    } catch (err) {
      const message = activityMessage(err);
      if (integrateAttempts < 1) {
        integrateAttempts += 1;
        integrating = true;
        humanNote = `${message}\n\nMerge the base branch into this work branch and resolve conflicts. Do not push.`;
        nextAgent = "implement";
        await updateWorkItemStatus({
          workItemId: input.workItemId,
          status: "running",
          currentAgent: "implement",
          waitingForReview: false,
          error: null,
        });
        return "continue";
      }
      if ((await pauseForUser(message)) === "stop") return "stopped";
      return shipOrContinue();
    }
    await finishMerged();
    return "done";
  }

  await updateWorkItemStatus({
    workItemId: input.workItemId,
    status: "running",
    currentAgent: pendingShip ? null : nextAgent,
    waitingForReview: false,
    error: null,
  });

  for (let step = 0; step < pipeline.maxSteps; step++) {
    if (pendingShip) {
      pendingShip = false;
      const outcome = await shipOrContinue();
      if (outcome !== "continue") return;
      continue;
    }

    const result = await runAgentActivity({
      workItemId: input.workItemId,
      projectId: input.projectId,
      sourceId: input.sourceId,
      agentName: nextAgent,
      priorTranscripts: prior.slice(-3),
      humanNote,
      configSha,
    });
    humanNote = undefined;

    if (result.status === "error") {
      if (integrating) {
        if ((await pauseForUser(result.error ?? "Could not update the branch onto main")) === "stop") {
          return;
        }
        pendingShip = true;
        continue;
      }
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
      workItemId: input.workItemId,
      sourceId: input.sourceId,
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

    if (integrating && nextAgent === "implement") {
      nextAgent = "verify";
      humanNote = "The branch was just updated onto the latest base. Run the checks. Do not redesign the feature.";
      continue;
    }

    if (integrating && nextAgent === "verify") {
      if (result.verifyVerdict === "fail") {
        if ((await pauseForUser("Verify failed after updating the branch onto main.")) === "stop") {
          return;
        }
      }
      pendingShip = true;
      continue;
    }

    const routed = nextStep({
      pipeline,
      agentName: nextAgent,
      result: {
        decision: result.decision,
        reviewVerdict: result.reviewVerdict,
        verifyVerdict: result.verifyVerdict,
      },
      revisionLoops,
    });

    if (routed.kind === "fail") {
      await updateWorkItemStatus({
        workItemId: input.workItemId,
        status: "failed",
        error: routed.note,
      });
      return;
    }

    if (routed.kind === "complete") {
      pendingShip = true;
      continue;
    }

    revisionLoops = routed.revisionLoops;
    if (nextAgent === "foreman" && routed.agent !== "foreman") {
      const ok = await canSpawn({
        workItemId: input.workItemId,
        sourceId: input.sourceId,
        parentAgent: "foreman",
        childAgent: routed.agent,
      });
      if (!ok) {
        await updateWorkItemStatus({
          workItemId: input.workItemId,
          status: "failed",
          error: `cannot spawn ${routed.agent}`,
        });
        return;
      }
    }
    nextAgent = routed.agent;
  }

  await updateWorkItemStatus({
    workItemId: input.workItemId,
    status: "failed",
    error: "exceeded max workflow steps",
  });
}

/** Re-run learn from the current factory-config. Does not use the work item pin. */
export async function learnWorkflow(input: LearnWorkflowInput): Promise<void> {
  let agentName = "monitor";
  try {
    const latest = await latestConfigSha({ sourceId: input.sourceId });
    agentName = latest.pipeline.learnAgent;
    const result = await runAgentActivity({
      workItemId: input.workItemId,
      projectId: input.projectId,
      sourceId: input.sourceId,
      agentName,
      priorTranscripts: [],
      configSha: latest.configSha,
    });
    await updateWorkItemStatus({
      workItemId: input.workItemId,
      status: "completed",
      currentAgent: agentName,
      waitingForReview: false,
      error: result.status === "error" ? result.error ?? "learn failed" : null,
    });
  } catch (err) {
    await updateWorkItemStatus({
      workItemId: input.workItemId,
      status: "completed",
      currentAgent: agentName,
      waitingForReview: false,
      error: activityMessage(err),
    });
  }
}

