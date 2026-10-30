export type MergeGate = {
  state: "ready" | "integrate" | "blocked";
  summary: string;
};

export type ShipStep =
  | { action: "merge" }
  | { action: "integrate"; note: string }
  | { action: "ask_user"; note: string };

export function classifyMergeGate(input: {
  mergeable: boolean | null;
  mergeableState: string | null;
  behindBy: number;
  draft: boolean;
  base: string;
  head: string;
  commits: string[];
}): MergeGate {
  const landed = input.commits.length
    ? `\nCommits on ${input.base} that are not in ${input.head}:\n${input.commits
        .map((line) => `- ${line}`)
        .join("\n")}`
    : "";
  const integrateSummary = [
    `Branch ${input.head} is behind ${input.base}.`,
    `Merge ${input.base} into ${input.head} and resolve any conflicts in the worktree.`,
    "This is normal when several factory issues are in flight.",
    "Do not redesign the feature. Do not push.",
    landed,
  ]
    .filter(Boolean)
    .join("\n");

  if (input.mergeableState === "blocked") {
    return {
      state: "blocked",
      summary: `GitHub is blocking the merge of ${input.head} into ${input.base} (branch protection or required reviews).${landed}`,
    };
  }
  if (
    input.behindBy > 0 ||
    input.mergeableState === "dirty" ||
    input.mergeableState === "behind"
  ) {
    return { state: "integrate", summary: integrateSummary };
  }
  if (input.draft || input.mergeable === true || input.mergeableState === "clean" || input.mergeableState === "unstable") {
    return { state: "ready", summary: "" };
  }
  if (input.mergeable === false) {
    return {
      state: "blocked",
      summary: `Pull request is not mergeable (${input.mergeableState ?? "unknown"}).${landed}`,
    };
  }
  return { state: "ready", summary: "" };
}

/** One implement pass updates the branch. A second miss pauses for a person. */
export function nextShipStep(gate: MergeGate, integrateAttempts: number): ShipStep {
  if (gate.state === "ready") return { action: "merge" };
  if (gate.state === "integrate" && integrateAttempts < 1) {
    return { action: "integrate", note: gate.summary };
  }
  return { action: "ask_user", note: gate.summary };
}
