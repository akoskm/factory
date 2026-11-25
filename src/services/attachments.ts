import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export function attachmentsRoot(): string {
  return process.env.ATTACHMENTS_DIR ?? path.resolve(process.cwd(), "attachments");
}

export function workItemAttachmentsDir(workItemId: string): string {
  return path.join(attachmentsRoot(), workItemId);
}

export async function saveWorkItemAttachment(input: {
  workItemId: string;
  filename: string;
  mimeType: string;
  bytes: Buffer;
}): Promise<{ absPath: string; relPath: string; size: number }> {
  const dir = workItemAttachmentsDir(input.workItemId);
  await mkdir(dir, { recursive: true });
  const safe = input.filename.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "file";
  const stored = `${randomUUID()}-${safe}`;
  const absPath = path.join(dir, stored);
  await writeFile(absPath, input.bytes);
  return {
    absPath,
    relPath: path.join(".factory", "steer", stored),
    size: input.bytes.length,
  };
}

export async function readAttachmentBytes(absPath: string): Promise<Buffer> {
  return readFile(absPath);
}

export function isImageMime(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}
