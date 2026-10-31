import { useMemo } from "react";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./pipeline-flow.css";
import { cn } from "cn";
import {
  buildPipelineGraph,
  type PipelineGraphNode,
  type PipelineNodeKind,
  type PipelineView,
} from "../pipeline-graph";

type StepData = {
  label: string;
  kind: PipelineNodeKind;
};

const kindLabel: Record<PipelineNodeKind, string> = {
  start: "starts the run",
  agent: "agent",
  step: "on complete",
  fail: "stops the run",
};

function StepNode({ data }: NodeProps<Node<StepData>>) {
  return (
    <div
      className={cn(
        "w-[168px] rounded-lg border bg-card px-3 py-2 shadow-sm",
        data.kind === "start" && "border-foreground",
        data.kind === "step" && "border-dashed",
        data.kind === "fail" && "border-destructive",
      )}
    >
      <Handle type="target" position={Position.Left} id="in-l" />
      <Handle type="source" position={Position.Left} id="out-l" />
      <Handle type="target" position={Position.Right} id="in-r" />
      <Handle type="source" position={Position.Right} id="out-r" />
      <Handle type="target" position={Position.Top} id="in-t" />
      <Handle type="source" position={Position.Top} id="out-t" />
      <Handle type="target" position={Position.Bottom} id="in-b" />
      <Handle type="source" position={Position.Bottom} id="out-b" />
      <div className="truncate text-sm font-medium">{data.label}</div>
      <div
        className={cn(
          "text-[11px] text-muted-foreground",
          data.kind === "fail" && "text-destructive",
        )}
      >
        {kindLabel[data.kind]}
      </div>
    </div>
  );
}

const nodeTypes = { step: StepNode };

function handles(source: PipelineGraphNode, target: PipelineGraphNode) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? { sourceHandle: "out-r", targetHandle: "in-l" }
      : { sourceHandle: "out-l", targetHandle: "in-r" };
  }
  return dy >= 0
    ? { sourceHandle: "out-b", targetHandle: "in-t" }
    : { sourceHandle: "out-t", targetHandle: "in-b" };
}

export function PipelineFlow({ pipeline }: { pipeline: PipelineView }) {
  const graph = useMemo(() => buildPipelineGraph(pipeline), [pipeline]);
  const byId = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);
  const nodes: Node<StepData>[] = graph.nodes.map((node) => ({
    id: node.id,
    type: "step",
    position: { x: node.x, y: node.y },
    data: { label: node.label, kind: node.kind },
    draggable: true,
  }));
  const edges: Edge[] = graph.edges.map((edge) => {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    const ports = source && target ? handles(source, target) : {};
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      ...ports,
      style: edge.label === "fail" ? { stroke: "var(--destructive)" } : undefined,
    };
  });
  const height = Math.min(
    640,
    Math.max(320, Math.max(...graph.nodes.map((node) => node.y), 0) + 160),
  );

  return (
    <div className="pipeline-flow w-full overflow-hidden rounded-lg bg-muted/30" style={{ height }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        nodesConnectable={false}
        zoomOnScroll={false}
        proOptions={{ hideAttribution: true }}
        colorMode="dark"
      >
        <Background gap={16} size={1} color="var(--border)" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
