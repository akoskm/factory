import { claudeCodeHarness } from "./claude-code.js";
import { cursorHarness } from "./cursor.js";
import { localHarness } from "./local.js";
import type { Harness } from "./types.js";

const harnesses: Record<string, Harness> = {
  cursor: cursorHarness,
  "claude-code": claudeCodeHarness,
  local: localHarness,
};

export function getHarness(name: string): Harness {
  const h = harnesses[name];
  if (!h) throw new Error(`Unknown harness: ${name}`);
  return h;
}

export type { Harness, HarnessRunResult } from "./types.js";
