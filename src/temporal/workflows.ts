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
import { nextStep, type NextStep } from "./pipeline.js";
import type { PipelineConfig } from "../config/load.js";
import { settleReview, type WorkPhase } from "../work-item-phase.js";

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
  setLearnError,
  lastAgentResult,
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
  let revisionLoops = input.revisionLoops ?? 0;
  let integrateAttempts = input.integrateAttempts ?? 0;
  let phase: WorkPhase = input.phase ?? (input.startAgent === "ship" ? "ship" : "step");
  let integrating = phase === "integrate" || phase === "recheck";
  let pendingShip = phase === "ship" && !input.hold;
  let humanNote: string | undefined;

  const pinned = await pinConfigSha({
    workItemId: input.workItemId,
    sourceId: input.sourceId,
  });
  const pipeline: PipelineConfig = pinned.pipeline;
  const configSha = pinned.configSha;
  let nextAgent =
    input.hold === "waiting_review"
      ? input.startAgent?.trim() || pipeline.startAgent || "foreman"
      : phase === "recheck"
        ? "verify"
        : phase === "integrate" || phase === "ship"
          ? "implement"
          : input.startAgent?.trim() || pipeline.startAgent || "foreman";

  async function mark(patch: {
    status: string;
    phase?: WorkPhase;
    agent?: string | null;
    error?: string | null;
    completedAt?: string;
  }): Promise<void> {
    if (patch.phase) phase = patch.phase;
    await updateWorkItemStatus({
      workItemId: input.workItemId,
      status: patch.status,
      phase,
      integrateAttempts,
      revisionLoops,
      ...(patch.agent !== undefined ? { currentAgent: patch.agent } : {}),
      ...(patch.error !== undefined ? { error: patch.error } : {}),
      ...(patch.completedAt ? { completedAt: patch.completedAt } : {}),
    });
  }

  async function pauseForUser(note: string): Promise<"continue" | "stop"> {
    reviewState.pending = null;
    await mark({ status: "needs_user", phase: "ship", agent: null, error: note });
    const got = await condition(() => reviewState.pending !== null, "7 days");
    const signal = reviewState.pending as ReviewSignal | null;
    reviewState.pending = null;
    const settled = settleReview({
      status: "needs_user",
      decision: got && signal ? signal.decision : null,
      note: signal?.note,
      fallbackNote: note,
      revisionLoops,
      revisionCap: pipeline.revisionCap,
    });
    if (settled.kind === "stop") {
      await mark({ status: "failed", error: settled.error });
      return "stop";
    }
    await mark({ status: "running", error: null });
    return "continue";
  }

  async function waitForAgentReview(agent: string) {
    reviewState.pending = null;
    await mark({ status: "waiting_review", agent });
    const got = await condition(() => reviewState.pending !== null, "7 days");
    const signal = reviewState.pending as ReviewSignal | null;
    reviewState.pending = null;
    return settleReview({
      status: "waiting_review",
      decision: got && signal ? signal.decision : null,
      note: signal?.note,
      fallbackNote: "review wait timed out",
      revisionLoops,
      revisionCap: pipeline.revisionCap,
    });
  }

  async function applyRouted(routed: NextStep): Promise<"return" | "go"> {
    if (routed.kind === "fail") {
      await mark({ status: "failed", error: routed.note });
      return "return";
    }
    if (routed.kind === "complete") {
      integrating = false;
      pendingShip = true;
      await mark({ status: "running", phase: "ship", agent: null, error: null });
      return "go";
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
        await mark({ status: "failed", error: `cannot spawn ${routed.agent}` });
        return "return";
      }
    }
    nextAgent = routed.agent;
    integrating = false;
    return "go";
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
          await mark({ status: "failed", phase: "on_complete", error: activityMessage(err) });
          return;
        }
        continue;
      }
      await mark({ status: "running", phase: "on_complete", agent: action.name, error: null });
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
      if (agent.status === "error") {
        await mark({
          status: "failed",
          phase: "on_complete",
          agent: action.name,
          error: agent.error ?? `${action.name} failed`,
        });
        return;
      }
    }
    await mark({
      status: "completed",
      phase: "on_complete",
      ...(currentAgent ? { agent: currentAgent } : {}),
      error: null,
      completedAt: new Date().toISOString(),
    });
  }

  /** Merge when the PR is up to date. Otherwise send implement at the branch, once. */
  async function shipOrContinue(): Promise<"done" | "stopped" | "continue"> {
    phase = "ship";
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
      await mark({ status: "running", phase: "integrate", agent: "implement", error: null });
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
      const retry = nextShipStep(gate, integrateAttempts, activityMessage(err));
      if (retry.action === "integrate") {
        integrateAttempts += 1;
        integrating = true;
        humanNote = retry.note;
        nextAgent = "implement";
        await mark({ status: "running", phase: "integrate", agent: "implement", error: null });
        return "continue";
      }
      if (retry.action === "ask_user") {
        if ((await pauseForUser(retry.note)) === "stop") return "stopped";
      }
      return shipOrContinue();
    }
    phase = "on_complete";
    await finishMerged();
    return "done";
  }

  if (input.hold === "needs_user") {
    if ((await pauseForUser(input.holdError?.trim() || "Needs you")) === "stop") return;
    pendingShip = true;
    integrating = false;
  } else if (input.hold === "waiting_review") {
    const settled = await waitForAgentReview(nextAgent);
    if (settled.kind === "stop") {
      await mark({ status: "failed", error: settled.error });
      return;
    }
    if (settled.kind === "revise") {
      humanNote = settled.note;
      revisionLoops = settled.revisionLoops;
    } else {
      const last = await lastAgentResult({
        workItemId: input.workItemId,
        agentName: nextAgent,
      });
      if (!last) {
        await mark({ status: "failed", error: "lost last agent result" });
        return;
      }
      if (integrating && nextAgent === "implement") {
        nextAgent = "verify";
        humanNote =
          "The branch was just updated onto the latest base. Run the checks. Do not redesign the feature.";
      } else if (integrating && nextAgent === "verify") {
        if (last.verifyVerdict !== "accept") {
          const note =
            last.verifyVerdict === "fail"
              ? "Verify failed after updating the branch onto main."
              : "Verify returned no verdict after updating the branch onto main.";
          if ((await pauseForUser(note)) === "stop") return;
        }
        integrating = false;
        pendingShip = true;
      } else if ((await applyRouted(nextStep({
        pipeline,
        agentName: nextAgent,
        result: last,
        revisionLoops,
      }))) === "return") {
        return;
      }
    }
  }

  if (phase === "on_complete") {
    await finishMerged();
    return;
  }

  if (pendingShip) {
    await mark({ status: "running", phase: "ship", agent: null, error: null });
  }

  for (let step = 0; step < pipeline.maxSteps; step++) {
    if (pendingShip) {
      pendingShip = false;
      const outcome = await shipOrContinue();
      if (outcome !== "continue") return;
      continue;
    }

    phase = integrating ? (nextAgent === "verify" ? "recheck" : "integrate") : "step";
    await mark({ status: "running", phase, agent: nextAgent, error: null });

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
      await mark({
        status: "failed",
        error: result.error ?? "agent error",
        agent: nextAgent,
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
      const settled = await waitForAgentReview(nextAgent);
      if (settled.kind === "stop") {
        await mark({ status: "failed", error: settled.error });
        return;
      }
      if (settled.kind === "revise") {
        humanNote = settled.note;
        revisionLoops = settled.revisionLoops;
        continue;
      }
    }

    if (integrating && nextAgent === "implement") {
      nextAgent = "verify";
      humanNote =
        "The branch was just updated onto the latest base. Run the checks. Do not redesign the feature.";
      continue;
    }

    if (integrating && nextAgent === "verify") {
      if (result.verifyVerdict !== "accept") {
        const note =
          result.verifyVerdict === "fail"
            ? "Verify failed after updating the branch onto main."
            : "Verify returned no verdict after updating the branch onto main.";
        if ((await pauseForUser(note)) === "stop") return;
      }
      integrating = false;
      pendingShip = true;
      await mark({ status: "running", phase: "ship", agent: null, error: null });
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
    if ((await applyRouted(routed)) === "return") return;
  }

  await mark({ status: "failed", error: "exceeded max workflow steps" });
}

/** Re-run learn from the current factory-config. Does not use the work item pin or its status. */
export async function learnWorkflow(input: LearnWorkflowInput): Promise<void> {
  try {
    const latest = await latestConfigSha({ sourceId: input.sourceId });
    const result = await runAgentActivity({
      workItemId: input.workItemId,
      projectId: input.projectId,
      sourceId: input.sourceId,
      agentName: latest.pipeline.learnAgent,
      priorTranscripts: [],
      configSha: latest.configSha,
    });
    await setLearnError({
      workItemId: input.workItemId,
      error: result.status === "error" ? result.error ?? "learn failed" : null,
    });
  } catch (err) {
    await setLearnError({
      workItemId: input.workItemId,
      error: activityMessage(err),
    });
  }
}
