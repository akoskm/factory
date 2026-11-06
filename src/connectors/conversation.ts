export type ThreadComment = {
  createdAt: string;
  author: string;
  body: string;
};

const CODE_AGENT_TYPES = new Set(["IMPLEMENT", "REVIEW", "VERIFY"]);
const CODE_AGENT_NAMES = new Set(["implement", "review", "verify"]);
const CONVERSATION_MAX_CHARS = 24_000;

export function isCodeAgent(agentName: string, agentType: string): boolean {
  return CODE_AGENT_NAMES.has(agentName) || CODE_AGENT_TYPES.has(agentType.toUpperCase());
}

/** Code agents comment on the product PR once it exists. Spec, coordination, and learn stay on the issue. */
export function postsOnPullRequest(input: {
  agentName: string;
  agentType: string;
  prNumber: number | null | undefined;
  learn?: boolean;
}): boolean {
  if (input.learn) return false;
  return input.prNumber != null && isCodeAgent(input.agentName, input.agentType);
}

function time(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Issue comments and pull-request comments, oldest first, as one thread. */
export function formatConversation(input: {
  issueNumber: string;
  prNumber: number | null;
  issueComments: ThreadComment[];
  prComments: ThreadComment[];
  maxChars?: number;
}): string {
  const maxChars = input.maxChars ?? CONVERSATION_MAX_CHARS;
  const rows = [
    ...input.issueComments.map((comment) => ({ ...comment, where: `issue #${input.issueNumber}` })),
    ...input.prComments.map((comment) => ({
      ...comment,
      where: `pull request #${input.prNumber}`,
    })),
  ]
    .filter((row) => row.body.trim())
    .sort((a, b) => time(a.createdAt) - time(b.createdAt) || a.where.localeCompare(b.where));

  if (!rows.length) return "";

  const header = [
    "# Conversation",
    "Factory comments in time order. Spec and coordination are on the issue. Code review is on the pull request. Treat both as one thread.",
  ].join("\n");
  const blocks = rows.map((row) => `## ${row.where} — ${row.author}\n${row.body.trim()}`);
  while (blocks.length > 1 && [header, ...blocks].join("\n\n").length > maxChars) {
    blocks.shift();
  }
  return [header, ...blocks].join("\n\n");
}

export async function loadWorkItemConversation(input: {
  issueNumber: string;
  prNumber: number | null;
  listComments: (issueNumber: number) => Promise<ThreadComment[]>;
}): Promise<string> {
  const issueNumber = Number(input.issueNumber);
  if (!Number.isInteger(issueNumber)) return "";
  const issueComments = await input.listComments(issueNumber).catch(() => [] as ThreadComment[]);
  const prComments =
    input.prNumber != null
      ? await input.listComments(input.prNumber).catch(() => [] as ThreadComment[])
      : [];
  return formatConversation({
    issueNumber: input.issueNumber,
    prNumber: input.prNumber,
    issueComments,
    prComments,
  });
}
