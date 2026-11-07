import {
  Bot,
  CircleCheck,
  CircleDashed,
  CodeXml,
  FileText,
  GitBranch,
  MessagesSquare,
  type LucideIcon,
} from "lucide-react";
import { cn } from "cn";
import { agentMark, type AgentIcon } from "../agent-mark";

const ICONS: Record<AgentIcon, LucideIcon> = {
  "git-branch": GitBranch,
  messages: MessagesSquare,
  code: CodeXml,
  file: FileText,
  "circle-dashed": CircleDashed,
  check: CircleCheck,
  bot: Bot,
};

export function AgentChip({
  agentType,
  size = "md",
  className,
}: {
  agentType: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const mark = agentMark(agentType);
  const Icon = ICONS[mark.icon];
  return (
    <span
      data-agent-tone={mark.tone}
      className={cn("agent-chip", `agent-chip-${mark.tone}`, size === "sm" && "agent-chip-sm", className)}
      aria-hidden
    >
      <Icon />
    </span>
  );
}
