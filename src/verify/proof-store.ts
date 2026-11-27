import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { workItemProofs } from "../db/schema.js";
import type { ProofFileMeta } from "./types.js";

export function proofsRoot(): string {
  return process.env.PROOFS_DIR?.trim() || path.resolve("proofs");
}

export function workItemProofDir(workItemId: string): string {
  return path.join(proofsRoot(), workItemId);
}

export function publicFactoryUrl(): string {
  const fromEnv = process.env.FACTORY_PUBLIC_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const port = process.env.PORT?.trim() || "3000";
  return `http://localhost:${port}`;
}

export function newUploadToken(): string {
  return randomBytes(24).toString("hex");
}

export async function saveProofFile(input: {
  workItemId: string;
  filename: string;
  mimeType: string;
  bytes: Buffer;
  title?: string;
  sha?: string;
}): Promise<ProofFileMeta> {
  const safe = path.basename(input.filename).replace(/[^\w.\-]+/g, "_") || "proof.bin";
  const dir = workItemProofDir(input.workItemId);
  await mkdir(dir, { recursive: true });
  const hash = createHash("sha256").update(input.bytes).digest("hex").slice(0, 10);
  const storedName = `${hash}-${safe}`;
  const abs = path.join(dir, storedName);
  await writeFile(abs, input.bytes);
  await db
    .insert(workItemProofs)
    .values({
      workItemId: input.workItemId,
      filename: storedName,
      mimeType: input.mimeType,
      title: input.title ?? safe,
      path: abs,
      size: input.bytes.length,
      sha: input.sha ?? null,
    })
    .onConflictDoNothing();
  return {
    filename: storedName,
    mimeType: input.mimeType,
    title: input.title ?? safe,
    size: input.bytes.length,
  };
}

export async function listProofFiles(workItemId: string, sha?: string): Promise<
  (ProofFileMeta & { id: string; path: string })[]
> {
  const rows = sha
    ? await db
        .select()
        .from(workItemProofs)
        .where(and(eq(workItemProofs.workItemId, workItemId), eq(workItemProofs.sha, sha)))
    : await db.select().from(workItemProofs).where(eq(workItemProofs.workItemId, workItemId));
  return rows.map((r) => ({
    id: r.id,
    filename: r.filename,
    mimeType: r.mimeType,
    title: r.title ?? r.filename,
    size: r.size,
    path: r.path,
  }));
}

export async function readProofBytes(workItemId: string, filename: string): Promise<{
  bytes: Buffer;
  mimeType: string;
} | null> {
  const safe = path.basename(filename);
  const [row] = await db
    .select()
    .from(workItemProofs)
    .where(and(eq(workItemProofs.workItemId, workItemId), eq(workItemProofs.filename, safe)))
    .limit(1);
  if (!row) return null;
  try {
    const bytes = await readFile(row.path);
    return { bytes, mimeType: row.mimeType };
  } catch {
    return null;
  }
}
