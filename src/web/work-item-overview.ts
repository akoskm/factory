import { redactSecrets } from "../secrets/redact.js";

export type RunFact = {
  agentName: string;
  status: string;
  transcript: string;
  startedAt: string;
  decision: { action: string; agent?: string; note?: string } | null;
  error?: string | null;
};

const PROCESS_OPENER =
  /^(triageing|triaging|exploring|implementing|reviewing|verifying|fixing|checking|gathering)\b/i;

const GENERIC_HEADING =
  /^(summary|changes|commands|fix|also|acceptance criteria.*|open questions.*|validation.*)$/i;

/** Stored triage/spec text belongs on the step that wrote it. */
export function runIdForNote(
  artifact: { kind: string; runId?: string | null },
  runs: { id: string; agentName: string; startedAt: string }[],
): string | null {
  if (artifact.runId && runs.some((run) => run.id === artifact.runId)) return artifact.runId;
  const matches = runs.filter((run) => run.agentName === artifact.kind);
  if (matches.length === 0) return null;
  return matches.reduce((latest, run) =>
    Date.parse(run.startedAt) >= Date.parse(latest.startedAt) ? run : latest,
  ).id;
}

export function displayError(error: string): string {
  return redactSecrets(error);
}

function clip(text: string, max = 160): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > 80 ? cut.slice(0, space) : cut).trim()}…`;
}

function stripMd(line: string): string {
  return line
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function verdictOf(transcript: string): "accept" | "revise" | "fail" | null {
  const verdict = transcript.match(/verdict:\s*(accept|revise|fail)/i)?.[1]?.toLowerCase();
  if (verdict === "accept" || verdict === "revise" || verdict === "fail") return verdict;
  return null;
}

function usefulLine(transcript: string): string | null {
  let inFence = false;
  for (const raw of transcript.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !line || line.startsWith("|") || line.startsWith("---")) continue;
    const heading = line.match(/^#{1,3}\s+(.+)/);
    if (heading) {
      const text = stripMd(heading[1]);
      if (GENERIC_HEADING.test(text)) continue;
      return clip(text);
    }
    const prose = stripMd(line.replace(/^[-*]\s+/, ""));
    if (!prose || PROCESS_OPENER.test(prose)) continue;
    return clip(prose);
  }
  return null;
}

function labelAgent(name: string): string {
  if (!name) return "Agent";
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function firstErrorLine(error: string): string {
  const lines = error.split(/\r?\n/).map((part) => part.trim()).filter(Boolean);
  const preferred = [...lines].reverse().find((line) => /^(fatal|error|remote):/i.test(line));
  return clip(displayError(preferred ?? lines[0] ?? "The run failed."));
}

/** One line for a run row: the decision note, verdict, or the first useful transcript line. */
export function runHeadline(run: RunFact): string {
  if (run.decision?.note) return clip(run.decision.note);
  const verdict = verdictOf(run.transcript);
  if (run.agentName === "review" && verdict === "accept") return "Accepted the change.";
  if (run.agentName === "review" && verdict === "revise") return "Asked for a revision.";
  if (run.agentName === "verify" && verdict === "accept") return "Verification passed.";
  if (run.agentName === "verify" && verdict === "fail") return "Verification failed.";
  if ((run.status === "error" || run.status === "failed") && run.error) return firstErrorLine(run.error);
  const line = usefulLine(run.transcript);
  if (line) return line;
  if (run.status === "running") return "Still running.";
  if (run.status === "error" || run.status === "failed") return "The run failed.";
  return "Finished.";
}

function chronological(runs: RunFact[]): RunFact[] {
  return [...runs].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
}

function finished(run: RunFact): boolean {
  return run.status === "finished" || run.status === "completed";
}

function statusSentence(run: RunFact): string {
  const who = labelAgent(run.agentName);
  if (run.status === "running") return `${who} is running.`;
  if (run.status === "queued") return `${who} is queued.`;
  if (run.status === "error" || run.status === "failed") return `${who} failed.`;
  return `${who} finished.`;
}

function agentSentence(run: RunFact, reviseOpen: boolean, implemented: boolean): string {
  if (!finished(run)) return statusSentence(run);
  if (run.agentName === "triage") return "Triage classified the request.";
  if (run.agentName === "spec") return "Spec wrote the plan.";
  if (run.agentName === "implement") {
    if (reviseOpen) return "Implement addressed the review.";
    if (implemented) return "Implement changed the code again.";
    return "Implement changed the code.";
  }
  if (run.agentName === "review") {
    const verdict = verdictOf(run.transcript);
    if (verdict === "revise") return "Review asked for a revision.";
    if (verdict === "accept") return "Review accepted.";
    return "Review ran.";
  }
  if (run.agentName === "verify") {
    const verdict = verdictOf(run.transcript);
    if (verdict === "accept") return "Verify passed.";
    if (verdict === "fail") return "Verify failed.";
    return "Verify ran.";
  }
  return statusSentence(run);
}

/** Paragraph under the runs heading: how many runs, then what each one did. */
export function runsOverview(runs: RunFact[]): string {
  if (runs.length === 0) return "No agents have run on this item yet.";
  const ordered = chronological(runs);
  const sentences: string[] = [];
  let reviseOpen = false;
  let implemented = false;
  for (let i = 0; i < ordered.length; i++) {
    const run = ordered[i];
    const decision = run.decision;
    if (decision?.action === "spawn" && decision.agent) {
      if (ordered[i + 1]?.agentName !== decision.agent) {
        sentences.push(`Foreman sent this to ${decision.agent}.`);
      }
      continue;
    }
    if (decision?.action === "complete") {
      sentences.push("Foreman closed the work.");
      continue;
    }
    if (decision?.action === "fail") {
      sentences.push("Foreman stopped the run.");
      continue;
    }
    sentences.push(agentSentence(run, reviseOpen, implemented));
    if (run.agentName === "implement" && finished(run)) {
      reviseOpen = false;
      implemented = true;
    }
    if (run.agentName === "review") {
      const verdict = verdictOf(run.transcript);
      if (verdict === "revise") reviseOpen = true;
      if (verdict === "accept") reviseOpen = false;
    }
  }
  const count = `${runs.length} run${runs.length === 1 ? "" : "s"}.`;
  return `${count} ${sentences.join(" ")}`;
}

export function runsChronological<T extends { startedAt: string }>(runs: T[]): T[] {
  return [...runs].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
}
