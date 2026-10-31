export function issueNumberFromUrl(url: string): string | undefined {
  return url.match(/\/issues\/(\d+)/)?.[1];
}

export function issueLabel(url: string): string {
  const number = issueNumberFromUrl(url);
  return number ? `Issue #${number}` : "Issue";
}
