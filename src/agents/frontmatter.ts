import YAML from "yaml";
import { parseFrontmatter } from "./loader.js";

export function updateAgentHarnessModel(
  raw: string,
  harness: string,
  model: string,
): string {
  const { data, body } = parseFrontmatter(raw);
  const next = { ...data, harness, model };
  const fm = YAML.stringify(next).trimEnd();
  const trimmedBody = body.trimEnd();
  if (!trimmedBody) return `---\n${fm}\n---\n`;
  return `---\n${fm}\n---\n\n${trimmedBody}\n`;
}