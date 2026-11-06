import { isHarnessName, type HarnessName } from "../harnesses/types.js";

export function applyAgentOverride<T extends { harness: string; model: string }>(
  agent: T,
  override: { harness?: string | null; model?: string | null },
): T {
  const harness: HarnessName | T["harness"] =
    override.harness && isHarnessName(override.harness) ? override.harness : agent.harness;
  const model = override.model?.trim() || agent.model;
  if (harness === agent.harness && model === agent.model) return agent;
  return { ...agent, harness, model };
}
