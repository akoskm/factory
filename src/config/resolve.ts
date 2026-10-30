import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { secrets, sources } from "../db/schema.js";
import { decryptSecret } from "../crypto/secrets.js";
import {
  configCacheDir,
  ensureConfigCheckout,
  parseGithubRepo,
} from "./checkout.js";
import { resolveConfigRepo } from "../services/instance-settings.js";
import { findAgent, loadConfig, type FactoryConfig } from "./load.js";

export async function resolveGithubToken(preferredSourceId?: string): Promise<string | undefined> {
  if (preferredSourceId) {
    const [source] = await db.select().from(sources).where(eq(sources.id, preferredSourceId)).limit(1);
    if (source?.secretId) {
      const [sec] = await db.select().from(secrets).where(eq(secrets.id, source.secretId)).limit(1);
      if (sec) return decryptSecret(sec.ciphertext);
    }
  }
  if (process.env.GITHUB_TOKEN?.trim()) return process.env.GITHUB_TOKEN.trim();
  const all = await db.select().from(secrets);
  const gh = all.find((s) => s.key === "GITHUB_TOKEN");
  if (gh) return decryptSecret(gh.ciphertext);
  return undefined;
}

export async function loadFactoryConfigAtSha(input: {
  sha?: string | null;
  sourceId?: string;
}): Promise<{ config: FactoryConfig; sha: string; repoUrl: string }> {
  const repoUrl = await resolveConfigRepo();
  const token = await resolveGithubToken(input.sourceId);
  const { dir, sha } = await ensureConfigCheckout({
    repoUrl,
    token,
    cacheDir: configCacheDir(),
    sha: input.sha ?? undefined,
  });
  const config = await loadConfig(dir);
  return { config, sha, repoUrl };
}

export async function loadAgentFromConfig(input: {
  sha?: string | null;
  sourceId?: string;
  agentName: string;
}) {
  const { config, sha, repoUrl } = await loadFactoryConfigAtSha(input);
  const agent = findAgent(config, input.agentName);
  if (!agent) {
    throw new Error(`agent ${input.agentName} not found in config at ${sha}`);
  }
  return { config, agent, sha, repoUrl };
}

export { parseGithubRepo };
export { resolveConfigRepo };
