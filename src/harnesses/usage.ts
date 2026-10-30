import type { HarnessRunResult } from "./types.js";

type TokenCounts = { inputTokens: number; outputTokens: number };

export type CursorCost = { rawCostCents: number; chargedCents: number };

export type CursorUsageReport = {
  usage?: TokenCounts;
  cost?: CursorCost;
};

export function usdFromCursorCost(cost: CursorCost | undefined): number | undefined {
  if (!cost) return undefined;
  const cents = cost.rawCostCents > 0 ? cost.rawCostCents : cost.chargedCents;
  return cents / 100;
}

function toUsage(
  tokens: TokenCounts | undefined,
  cost: CursorCost | undefined,
): HarnessRunResult["usage"] {
  const costUsd = usdFromCursorCost(cost);
  if (!tokens && costUsd == null) return undefined;
  return {
    inputTokens: tokens?.inputTokens ?? 0,
    outputTokens: tokens?.outputTokens ?? 0,
    ...(costUsd != null ? { costUsd } : {}),
  };
}

export async function resolveCursorUsage(
  getUsage: () => Promise<CursorUsageReport>,
  fallback?: TokenCounts,
  opts?: { attempts?: number; wait?: (ms: number) => Promise<void> },
): Promise<HarnessRunResult["usage"]> {
  const attempts = opts?.attempts ?? 4;
  const wait = opts?.wait ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  let tokens = fallback;
  let cost: CursorCost | undefined;
  for (let i = 0; i < attempts; i++) {
    try {
      const report = await getUsage();
      if (report.usage) tokens = report.usage;
      if (report.cost) {
        cost = report.cost;
        break;
      }
    } catch {
      break;
    }
    if (i < attempts - 1) await wait(500);
  }
  return toUsage(tokens, cost);
}

export function parseClaudeResult(stdout: string): {
  transcript: string;
  usage?: HarnessRunResult["usage"];
} {
  const trimmed = stdout.trim();
  try {
    const json = JSON.parse(trimmed) as {
      result?: unknown;
      total_cost_usd?: unknown;
      usage?: { input_tokens?: unknown; output_tokens?: unknown };
    };
    const hasResult = typeof json.result === "string";
    const hasCost = typeof json.total_cost_usd === "number";
    if (!hasResult && !hasCost) return { transcript: stdout };
    const hasTokens =
      typeof json.usage?.input_tokens === "number" ||
      typeof json.usage?.output_tokens === "number";
    const usage =
      hasCost || hasTokens
        ? {
            inputTokens: typeof json.usage?.input_tokens === "number" ? json.usage.input_tokens : 0,
            outputTokens:
              typeof json.usage?.output_tokens === "number" ? json.usage.output_tokens : 0,
            ...(hasCost ? { costUsd: json.total_cost_usd as number } : {}),
          }
        : undefined;
    return { transcript: hasResult ? String(json.result) : "", usage };
  } catch {
    return { transcript: stdout };
  }
}
