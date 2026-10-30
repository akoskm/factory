import { claudeCodeHarness } from "./claude-code.js";
import { cursorHarness } from "./cursor.js";
import type { Harness } from "./types.js";

const harnesses: Record<string, Harness> = {
  cursor: cursorHarness,
  "claude-code": claudeCodeHarness,
};

export function getHarness(name: string): Harness {
  const h = harnesses[name];
  if (!h) throw new Error(`Unknown harness: ${name}`);
  return h;
}

export type { Harness, HarnessRunResult } from "./types.js";
