export type PipelineView = {
  maxSteps: number;
  startAgent: string;
  revisionCap: number;
  workspaceAgents: string[];
  pushAgents: string[];
  learnAgent: string;
  routes: {
    review?: { revise?: string; default?: string };
    verify?: { fail?: string; default?: string };
    default?: string;
  };
  onComplete: string[];
};

export type PipelineNodeKind = "start" | "agent" | "step" | "fail";

export type PipelineGraphNode = {
  id: string;
  label: string;
  kind: PipelineNodeKind;
  x: number;
  y: number;
};

export type PipelineGraphEdge = {
  id: string;
  source: string;
  target: string;
  label: string;
};

export type FlowPresence = "here" | "waiting" | "failed" | "done";

/** Which block on the pipeline graph is the work item's current step. */
export function flowPresence(
  status: string,
  currentAgent: string | null,
  nodeId: string,
): FlowPresence | null {
  if (!currentAgent || currentAgent !== nodeId) return null;
  if (status === "failed" || status === "error") return "failed";
  if (status === "completed" || status === "merged" || status === "finished") return "done";
  if (status === "waiting_review" || status === "queued") return "waiting";
  return "here";
}

const COL = 240;
const ROW = 84;

/** Edges match the engine: foreman spawns workspace agents, routes return, onComplete runs in order. */
export function buildPipelineGraph(pipeline: PipelineView): {
  nodes: PipelineGraphNode[];
  edges: PipelineGraphEdge[];
} {
  const hub = pipeline.routes.default || pipeline.startAgent || "foreman";
  const nodes = new Map<string, PipelineNodeKind>();

  const ensure = (id: string, kind: PipelineNodeKind) => {
    if (!id) return;
    const existing = nodes.get(id);
    if (!existing) {
      nodes.set(id, kind);
      return;
    }
    if (kind === "start") nodes.set(id, "start");
    if (existing === "step" && (kind === "agent" || kind === "start")) nodes.set(id, kind);
  };

  ensure(hub, pipeline.startAgent === hub ? "start" : "agent");
  if (pipeline.startAgent) ensure(pipeline.startAgent, "start");
  for (const name of pipeline.workspaceAgents) {
    ensure(name, name === pipeline.startAgent ? "start" : "agent");
  }

  const reviewRevise = pipeline.routes.review?.revise ?? "implement";
  const reviewDefault = pipeline.routes.review?.default ?? hub;
  const verifyFailTarget = pipeline.routes.verify?.fail ?? "fail";
  const verifyDefault = pipeline.routes.verify?.default ?? hub;
  const hasReview = nodes.has("review");
  const hasVerify = nodes.has("verify");

  if (hasReview) {
    ensure(reviewRevise, reviewRevise === pipeline.startAgent ? "start" : "agent");
    ensure(reviewDefault, reviewDefault === pipeline.startAgent ? "start" : "agent");
  }
  if (hasVerify) {
    if (verifyFailTarget === "fail") ensure("fail", "fail");
    else ensure(verifyFailTarget, verifyFailTarget === pipeline.startAgent ? "start" : "agent");
    ensure(verifyDefault, verifyDefault === pipeline.startAgent ? "start" : "agent");
  }
  for (const step of pipeline.onComplete) {
    if (!nodes.has(step)) ensure(step, "step");
  }

  const edges: PipelineGraphEdge[] = [];
  const seen = new Set<string>();
  const link = (source: string, target: string, label: string) => {
    if (!source || !target || source === target || !nodes.has(source) || !nodes.has(target)) return;
    const id = `${source}|${label}|${target}`;
    if (seen.has(id)) return;
    seen.add(id);
    edges.push({ id, source, target, label });
  };

  for (const name of pipeline.workspaceAgents) {
    if (name !== hub) link(hub, name, "spawn");
  }
  for (const [name, kind] of nodes) {
    if (kind === "step" || kind === "fail" || name === hub) continue;
    if (name === "review") {
      link("review", reviewRevise, "revise");
      if (reviewDefault !== hub) link("review", reviewDefault, "default");
      continue;
    }
    if (name === "verify") {
      link("verify", verifyFailTarget === "fail" ? "fail" : verifyFailTarget, "fail");
      if (verifyDefault !== hub) link("verify", verifyDefault, "default");
    }
  }

  let prev = hub;
  pipeline.onComplete.forEach((step, index) => {
    link(prev, step, index === 0 ? "complete" : "then");
    prev = step;
  });

  const loopIds = [...nodes.keys()].filter((id) => {
    const kind = nodes.get(id);
    return id !== hub && (kind === "agent" || kind === "start");
  });
  const pos = new Map<string, { x: number; y: number }>();
  pos.set(hub, { x: 0, y: Math.max(0, ((loopIds.length - 1) * ROW) / 2) });
  loopIds.forEach((id, index) => pos.set(id, { x: COL, y: index * ROW }));
  if (nodes.get("fail") === "fail") {
    pos.set("fail", { x: COL * 2 + 48, y: pos.get("verify")?.y ?? 0 });
  }
  const bottom = Math.max(...[...pos.values()].map((point) => point.y)) + ROW + 36;
  let stepIndex = 0;
  for (const [id, kind] of nodes) {
    if (kind !== "step" || pos.has(id)) continue;
    pos.set(id, { x: stepIndex * COL, y: bottom });
    stepIndex += 1;
  }

  return {
    nodes: [...nodes.entries()].map(([id, kind]) => ({
      id,
      label: id,
      kind,
      x: pos.get(id)?.x ?? 0,
      y: pos.get(id)?.y ?? 0,
    })),
    edges,
  };
}
