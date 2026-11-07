export type AgentTone = "magenta" | "pink" | "blue" | "orange" | "indigo" | "teal" | "slate";

export type AgentIcon =
  | "git-branch"
  | "messages"
  | "code"
  | "file"
  | "circle-dashed"
  | "check"
  | "bot";

export type AgentMark = {
  tone: AgentTone;
  icon: AgentIcon;
};

const MARKS: Record<string, AgentMark> = {
  FOREMAN: { tone: "magenta", icon: "git-branch" },
  REVIEW: { tone: "pink", icon: "messages" },
  IMPLEMENT: { tone: "blue", icon: "code" },
  SPEC: { tone: "orange", icon: "file" },
  TRIAGE: { tone: "indigo", icon: "circle-dashed" },
  VERIFY: { tone: "teal", icon: "check" },
  CUSTOM: { tone: "slate", icon: "bot" },
};

export function agentMark(agentType: string | null | undefined): AgentMark {
  const key = (agentType ?? "").trim().toUpperCase();
  return MARKS[key] ?? MARKS.CUSTOM;
}

export function agentTypeByName(
  agents: { name: string; agentType: string }[],
): Record<string, string> {
  return Object.fromEntries(agents.map((agent) => [agent.name, agent.agentType]));
}
