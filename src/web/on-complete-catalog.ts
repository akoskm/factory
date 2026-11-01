export type CatalogAgent = { name: string; description: string };

export type CatalogRow = {
  name: string;
  kind: "Built-in" | "Agent";
  summary: string;
};

const builtInSteps: { name: string; summary: string }[] = [
  {
    name: "mergeProduct",
    summary: "The product pull request already merged. This entry marks that point.",
  },
  {
    name: "closeIssue",
    summary: "Closes the GitHub issue this run worked on.",
  },
];

const builtInByName = new Map(builtInSteps.map((step) => [step.name, step.summary]));

function describe(name: string, agents: Map<string, CatalogAgent>): CatalogRow {
  const builtIn = builtInByName.get(name);
  if (builtIn) return { name, kind: "Built-in", summary: builtIn };
  const agent = agents.get(name);
  return {
    name,
    kind: "Agent",
    summary: agent?.description || "Runs this agent.",
  };
}

/** Steps in onComplete, plus built-in steps the file does not list. */
export function onCompleteCatalog(
  onComplete: string[],
  agents: CatalogAgent[],
): { current: CatalogRow[]; missing: CatalogRow[] } {
  const byName = new Map(agents.map((agent) => [agent.name, agent]));
  const listed = new Set(onComplete);
  return {
    current: onComplete.map((name) => describe(name, byName)),
    missing: builtInSteps.filter((step) => !listed.has(step.name)).map((step) => describe(step.name, byName)),
  };
}
