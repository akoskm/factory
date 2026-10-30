import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { instanceSettings } from "../db/schema.js";
import {
  FACTORY_CONFIG_REPO_KEY,
  configRepoFromEnv,
} from "../config/checkout.js";

export async function getInstanceSetting(key: string): Promise<string | undefined> {
  const [row] = await db
    .select()
    .from(instanceSettings)
    .where(eq(instanceSettings.key, key))
    .limit(1);
  return row?.value?.trim() || undefined;
}

export async function setInstanceSetting(key: string, value: string): Promise<string> {
  const trimmed = value.trim();
  await db
    .insert(instanceSettings)
    .values({ key, value: trimmed, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: instanceSettings.key,
      set: { value: trimmed, updatedAt: new Date() },
    });
  return trimmed;
}

/** Settings DB first, then env. */
export async function resolveConfigRepo(): Promise<string> {
  const fromDb = await getInstanceSetting(FACTORY_CONFIG_REPO_KEY);
  if (fromDb) return fromDb;
  const fromEnv = configRepoFromEnv();
  if (fromEnv) return fromEnv;
  throw new Error(
    "FACTORY_CONFIG_REPO is required — set it in Settings or as the FACTORY_CONFIG_REPO env var",
  );
}

export async function getFactoryConfigSetting(): Promise<{
  repoUrl: string | null;
  source: "settings" | "env" | null;
}> {
  const fromDb = await getInstanceSetting(FACTORY_CONFIG_REPO_KEY);
  if (fromDb) return { repoUrl: fromDb, source: "settings" };
  const fromEnv = configRepoFromEnv();
  if (fromEnv) return { repoUrl: fromEnv, source: "env" };
  return { repoUrl: null, source: null };
}
