export function issueLabel(url: string): string {
  const number = url.match(/\/issues\/(\d+)/)?.[1];
  return number ? `Issue #${number}` : "Issue";
}
