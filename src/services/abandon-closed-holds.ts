import { eq, inArray } from "drizzle-orm";
import { createGitHubSource } from "../connectors/github.js";
import { decryptSecret } from "../crypto/secrets.js";
import { db } from "../db/index.js";
import { secrets, sources, workItems } from "../db/schema.js";
import { signalReview } from "../temporal/client.js";
import { syncInboxOnStatus } from "./inbox.js";

/**
 * Only abandon work that is *waiting*, not in-flight.
 * Closing the source issue is a normal on_complete step — never kill running/merged work for that.
 */
const ABANDONABLE = ["needs_user", "queued", "scheduled"] as const;

async function resolveGithubToken(secretId: string | null): Promise<string> {
  let token = process.env.GITHUB_TOKEN ?? "";
  if (secretId) {
    const [sec] = await db.select().from(secrets).where(eq(secrets.id, secretId)).limit(1);
    if (sec) token = decryptSecret(sec.ciphertext);
  }
  return token;
}

async function markFailed(id: string, priorError: string | null, note: string) {
  await db
    .update(workItems)
    .set({
      status: "failed",
      error: priorError ? `${priorError}\n${note}` : note,
    })
    .where(eq(workItems.id, id));
  await syncInboxOnStatus(id, "failed");
}

/**
 * If the source GitHub issue is closed while the item is still only waiting
 * (needs_user / queued / scheduled), fail it so it cannot block the queue.
 * Does not touch running work — the pipeline closes issues on purpose after merge.
 */
export async function abandonHoldsForClosedIssues(): Promise<number> {
  const rows = await db
    .select({
      id: workItems.id,
      sourceId: workItems.sourceId,
      externalId: workItems.externalId,
      workflowId: workItems.workflowId,
      status: workItems.status,
      error: workItems.error,
    })
    .from(workItems)
    .where(inArray(workItems.status, [...ABANDONABLE]));

  if (rows.length === 0) return 0;

  let abandoned = 0;
  const sourceCache = new Map<
    string,
    Awaited<ReturnType<typeof createGitHubSource>> | null
  >();

  async function githubFor(sourceId: string) {
    if (sourceCache.has(sourceId)) return sourceCache.get(sourceId)!;
    const [row] = await db.select().from(sources).where(eq(sources.id, sourceId)).limit(1);
    if (!row || row.kind !== "github") {
      sourceCache.set(sourceId, null);
      return null;
    }
    const token = await resolveGithubToken(row.secretId);
    if (!token) {
      sourceCache.set(sourceId, null);
      return null;
    }
    const gh = createGitHubSource({
      owner: row.config.owner,
      repo: row.config.repo,
      label: row.config.label,
      token,
    });
    sourceCache.set(sourceId, gh);
    return gh;
  }

  for (const item of rows) {
    try {
      const gh = await githubFor(item.sourceId);
      if (!gh) continue;
      const open = await gh.isIssueOpen(item.externalId);
      if (open) continue;

      const note = "Source issue was closed";
      if (item.status === "needs_user") {
        try {
          await signalReview(item.workflowId, "request_changes", note);
        } catch {
          await markFailed(item.id, item.error, note);
        }
      } else {
        await markFailed(item.id, item.error, note);
      }
      abandoned += 1;
    } catch (err) {
      console.error(`abandon closed item ${item.id} failed`, err);
    }
  }

  return abandoned;
}
