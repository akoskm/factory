import {
  condition,
  defineSignal,
  proxyActivities,
  setHandler,
  sleep,
} from "@temporalio/workflow";
import type * as activities from "./activities.js";
import type { LearnWorkflowInput, ReviewSignal, WorkItemWorkflowInput } from "./shared.js";
import { planOnComplete } from "./complete.js";
import { nextShipStep } from "./ship.js";
import { nextStep, type NextStep } from "./pipeline.js";
import type { PipelineConfig } from "../config/load.js";
import { parseHoldKind, settleReview, type HoldKind, type WorkPhase } from "../work-item-phase.js";

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
  planVerifyScenario,
  ensureProofWorkflow,
  dispatchProofWorkflow,
  pollProofWorkflow,
  finalizeVerifyProof,
  confirmProofPaidRunners,
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
    metadata?: Record<string, unknown>;
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
      ...(patch.metadata ? { metadata: patch.metadata } : {}),
    });
  }

  async function pauseForUser(
    note: string,
    opts?: {
      phase?: WorkPhase;
      agent?: string | null;
      options?: string[];
      holdKind?: HoldKind;
    },
  ): Promise<
    | { kind: "continue"; note?: string }
    | { kind: "stop" }
    | { kind: "revise"; note: string; agent?: string }
  > {
    reviewState.pending = null;
    const holdKind = opts?.holdKind ?? "ask_user";
    await mark({
      status: "needs_user",
      phase: opts?.phase ?? (holdKind === "bootstrap" || holdKind === "proof" ? "step" : "ship"),
      agent:
        opts?.agent !== undefined
          ? opts.agent
          : holdKind === "bootstrap" || holdKind === "proof"
            ? "verify"
            : null,
      error: note,
      metadata: {
        holdKind,
        ...(opts?.options !== undefined
          ? { askUserOptions: opts.options.length ? opts.options : null }
          : {}),
      },
    });
    const got = await condition(() => reviewState.pending !== null, "7 days");
    const signal = reviewState.pending as ReviewSignal | null;
    reviewState.pending = null;
    const settled = settleReview({
      status: "needs_user",
      holdKind,
      decision: got && signal ? signal.decision : null,
      note: signal?.note,
      fallbackNote: note,
      revisionLoops,
      revisionCap: pipeline.revisionCap,
    });
    if (settled.kind === "stop") {
      await mark({
        status: "failed",
        error: settled.error,
        metadata: { askUserOptions: null, holdKind: null },
      });
      return { kind: "stop" };
    }
    if (settled.kind === "revise") {
      revisionLoops = settled.revisionLoops;
      await mark({
        status: "running",
        error: null,
        metadata: { askUserOptions: null, holdKind: null },
      });
      return { kind: "revise", note: settled.note, agent: settled.agent };
    }
    if (holdKind === "bootstrap" && /paid runner/i.test(note)) {
      await confirmProofPaidRunners({ projectId: input.projectId });
    }
    await mark({
      status: "running",
      error: null,
      metadata: { askUserOptions: null, holdKind: null },
    });
    return { kind: "continue", note: signal?.note?.trim() || undefined };
  }

  /** Behavior proof path for the verify agent (product CI + Inbox). */
  async function runVerifyProof(): Promise<
    | { kind: "result"; verifyVerdict: "accept" | "fail"; transcript: string }
    | { kind: "stopped" }
    | { kind: "revise"; note: string; agent: string }
  > {
    const plan = await planVerifyScenario({
      workItemId: input.workItemId,
      projectId: input.projectId,
      sourceId: input.sourceId,
      recheck: integrating,
    });

    if (plan.kind === "hold") {
      const paused = await pauseForUser(plan.note, {
        phase: "step",
        agent: "verify",
        holdKind: "bootstrap",
      });
      if (paused.kind === "stop") return { kind: "stopped" };
      if (paused.kind === "revise") {
        return { kind: "revise", note: paused.note, agent: paused.agent ?? "implement" };
      }
      return runVerifyProof();
    }

    if (plan.kind === "skip") {
      const finalized = await finalizeVerifyProof({
        workItemId: input.workItemId,
        projectId: input.projectId,
        sourceId: input.sourceId,
        sha: "skipped",
        scenario: plan.reason,
        verifyVerdict: "accept",
        summary: plan.reason,
      });
      return {
        kind: "result",
        verifyVerdict: finalized.verifyVerdict,
        transcript: finalized.transcript,
      };
    }

    if (plan.kind === "reuse") {
      const reuseTranscript = [
        "## verify proof (reused)",
        `verdict: ${plan.verifyVerdict}`,
        "",
        "```artifact:verify-proof",
        JSON.stringify(plan.artifact, null, 2),
        "```",
      ].join("\n");
      // Prior media still needs the same proof hold — do not skip the human and
      // leave foreman to invent Accept/Reject buttons over a discarded run.
      if (plan.artifact.requiresHumanReview) {
        const paused = await pauseForUser(
          plan.artifact.summary || "Review the behavior proof on the pull request.",
          { phase: "step", agent: "verify", holdKind: "proof" },
        );
        if (paused.kind === "stop") return { kind: "stopped" };
        if (paused.kind === "revise") {
          return { kind: "revise", note: paused.note, agent: paused.agent ?? "implement" };
        }
      }
      return {
        kind: "result",
        verifyVerdict: plan.verifyVerdict,
        transcript: reuseTranscript,
      };
    }

    for (;;) {
      const ensured = await ensureProofWorkflow({
        workItemId: input.workItemId,
        projectId: input.projectId,
        sourceId: input.sourceId,
        workflow: plan.workflow,
      });
      if (ensured.kind === "ready") break;
      if (ensured.kind === "waiting") {
        await sleep("30 seconds");
        continue;
      }
      const paused = await pauseForUser(ensured.note, {
        phase: "step",
        agent: "verify",
        holdKind: "bootstrap",
      });
      if (paused.kind === "stop") return { kind: "stopped" };
      if (paused.kind === "revise") {
        return { kind: "revise", note: paused.note, agent: paused.agent ?? "implement" };
      }
    }

    let runId: number | undefined;
    let runUrl: string | undefined;
    for (;;) {
      const dispatched = await dispatchProofWorkflow({
        workItemId: input.workItemId,
        projectId: input.projectId,
        sourceId: input.sourceId,
        workflow: plan.workflow,
        sha: plan.sha,
        scenario: plan.scenario,
      });
      if (dispatched.kind === "started") {
        runId = dispatched.runId;
        runUrl = dispatched.runUrl;
        break;
      }
      const paused = await pauseForUser(dispatched.note, {
        phase: "step",
        agent: "verify",
        holdKind: "bootstrap",
      });
      if (paused.kind === "stop") return { kind: "stopped" };
      if (paused.kind === "revise") {
        return { kind: "revise", note: paused.note, agent: paused.agent ?? "implement" };
      }
    }

    // 45 minutes at 30s polls — avoid Date.now() in the workflow sandbox.
    const maxPolls = 90;
    let polls = 0;
    let poll = await pollProofWorkflow({
      workItemId: input.workItemId,
      projectId: input.projectId,
      sourceId: input.sourceId,
      workflow: plan.workflow,
      runId: runId!,
    });
    while (poll.kind === "running") {
      polls += 1;
      if (polls > maxPolls) {
        const paused = await pauseForUser(
          `Proof workflow still running after 45 minutes: ${runUrl ?? ""}`,
          { phase: "step", agent: "verify", holdKind: "bootstrap" },
        );
        if (paused.kind === "stop") return { kind: "stopped" };
        if (paused.kind === "revise") {
          return { kind: "revise", note: paused.note, agent: paused.agent ?? "implement" };
        }
        polls = 0;
      }
      await sleep("30 seconds");
      poll = await pollProofWorkflow({
        workItemId: input.workItemId,
        projectId: input.projectId,
        sourceId: input.sourceId,
        workflow: plan.workflow,
        runId: runId!,
      });
    }

    const verifyVerdict = poll.kind === "success" ? "accept" : "fail";
    const finalized = await finalizeVerifyProof({
      workItemId: input.workItemId,
      projectId: input.projectId,
      sourceId: input.sourceId,
      sha: plan.sha,
      scenario: plan.scenario,
      verifyVerdict,
      runId,
      runUrl: poll.kind === "timeout" ? runUrl : poll.runUrl,
      summary: poll.kind === "failure" || poll.kind === "timeout" ? poll.note : undefined,
    });

    if (finalized.requiresHumanReview) {
      const paused = await pauseForUser(
        finalized.artifact.summary || "Review the behavior proof on the pull request.",
        { phase: "step", agent: "verify", holdKind: "proof" },
      );
      if (paused.kind === "stop") return { kind: "stopped" };
      if (paused.kind === "revise") {
        return { kind: "revise", note: paused.note, agent: paused.agent ?? "implement" };
      }
    }

    return {
      kind: "result",
      verifyVerdict: finalized.verifyVerdict,
      transcript: finalized.transcript,
    };
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
    if (routed.kind === "ask_user") {
      const paused = await pauseForUser(routed.note, {
        phase: "step",
        agent: "foreman",
        options: routed.options,
        holdKind: "ask_user",
      });
      if (paused.kind === "stop") return "return";
      humanNote = paused.note;
      nextAgent = "foreman";
      integrating = false;
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
      if ((await pauseForUser(activityMessage(err))).kind === "stop") return "stopped";
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
      if ((await pauseForUser(step.note)).kind === "stop") return "stopped";
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
        if ((await pauseForUser(retry.note)).kind === "stop") return "stopped";
      }
      return shipOrContinue();
    }
    phase = "on_complete";
    await finishMerged();
    return "done";
  }

  if (input.hold === "needs_user") {
    const holdKind = parseHoldKind(input.holdKind) ?? "ask_user";
    const verifyHold = holdKind === "bootstrap" || holdKind === "proof";
    const midPipeline = phase === "step" && !verifyHold;
    const paused = await pauseForUser(input.holdError?.trim() || "Needs you", {
      phase: verifyHold || midPipeline ? "step" : "ship",
      agent: verifyHold ? "verify" : midPipeline ? "foreman" : null,
      holdKind,
    });
    if (paused.kind === "stop") return;
    if (paused.kind === "revise") {
      humanNote = paused.note;
      nextAgent = paused.agent ?? "implement";
      integrating = false;
      pendingShip = false;
    } else if (verifyHold) {
      humanNote = paused.note;
      nextAgent = "verify";
      pendingShip = false;
      integrating = false;
    } else if (midPipeline) {
      humanNote = paused.note;
      nextAgent = "foreman";
      pendingShip = false;
      integrating = false;
    } else {
      pendingShip = true;
      integrating = false;
    }
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
          if ((await pauseForUser(note)).kind === "stop") return;
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

    if (nextAgent === "verify") {
      const proof = await runVerifyProof();
      if (proof.kind === "stopped") return;
      if (proof.kind === "revise") {
        humanNote = proof.note;
        nextAgent = proof.agent;
        integrating = false;
        continue;
      }
      prior.push(summarizePrior("verify", {
        verifyVerdict: proof.verifyVerdict,
        transcript: proof.transcript,
      }));
      if (integrating) {
        if (proof.verifyVerdict !== "accept") {
          const note = "Verify failed after updating the branch onto main.";
          if ((await pauseForUser(note)).kind === "stop") return;
        }
        integrating = false;
        pendingShip = true;
        await mark({ status: "running", phase: "ship", agent: null, error: null });
        continue;
      }
      const routed = nextStep({
        pipeline,
        agentName: "verify",
        result: { verifyVerdict: proof.verifyVerdict },
        revisionLoops,
      });
      if ((await applyRouted(routed)) === "return") return;
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
        if ((await pauseForUser(result.error ?? "Could not update the branch onto main")).kind === "stop") {
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
