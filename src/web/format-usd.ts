export function formatUsd(value: string | number | null | undefined): string | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  const abs = Math.abs(n);
  const digits = abs !== 0 && abs < 0.01 ? 4 : 2;
  return `$${n.toFixed(digits)}`;
}
