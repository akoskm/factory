export type OnCompleteAction =
  | { kind: "skip"; name: "mergeProduct" }
  | { kind: "closeIssue" }
  | { kind: "agent"; name: string };

/** `mergeProduct` already ran in the ship path. Every other name is an agent. */
export function planOnComplete(onComplete: string[]): OnCompleteAction[] {
  return onComplete.map((name) => {
    if (name === "mergeProduct") return { kind: "skip", name: "mergeProduct" };
    if (name === "closeIssue") return { kind: "closeIssue" };
    return { kind: "agent", name };
  });
}
