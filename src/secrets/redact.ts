const URL_USERINFO = /([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):[^@\s/]+@/gi;
const GITHUB_TOKEN = /\b(?:github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9_]+)/g;
const AUTH_HEADER = /\b(authorization:\s*(?:basic|bearer)\s+)\S+/gi;

/** Strip credentials from text before it is stored or shown. */
export function redactSecrets(text: string): string {
  return text
    .replace(URL_USERINFO, "$1$2:[redacted]@")
    .replace(GITHUB_TOKEN, "[redacted]")
    .replace(AUTH_HEADER, "$1[redacted]");
}
