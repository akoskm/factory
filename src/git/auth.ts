/** Drop userinfo so a remote URL can be stored and logged. */
export function publicGitUrl(repoUrl: string): string {
  return repoUrl.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/\s@]+@/i, (prefix) => {
    const scheme = prefix.slice(0, prefix.indexOf("://") + 3);
    return scheme;
  });
}

/**
 * GitHub HTTPS auth for one git process.
 * The token stays in the environment. It is not a command argument, so a
 * failed command's error text does not contain it, and git does not write it
 * into .git/config.
 */
export function githubAuthEnv(
  token?: string,
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, GIT_TERMINAL_PROMPT: "0" };
  if (!token) return env;
  const basic = Buffer.from(`x-access-token:${token}`, "utf8").toString("base64");
  env.GIT_CONFIG_COUNT = "1";
  env.GIT_CONFIG_KEY_0 = "http.https://github.com/.extraheader";
  env.GIT_CONFIG_VALUE_0 = `AUTHORIZATION: basic ${basic}`;
  return env;
}
