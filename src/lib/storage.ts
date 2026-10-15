import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

// Uploaded files (document PDFs, images attached in chat) live outside
// `public/`, so they're never served directly — every route that serves one
// checks ownership first.
// UPLOAD_DIR lets tests (and deployments) point somewhere other than ./uploads.
function uploadRoot(): string {
  // turbopackIgnore: this is runtime data, not code. Without it, Next's build
  // can't tell which files this path reaches and traces the whole project
  // (uploads included) into the deployment output.
  return path.resolve(/* turbopackIgnore: true */ process.env.UPLOAD_DIR ?? "uploads");
}

/**
 * Storage key for a document's PDF, relative to the upload root and always
 * "/"-separated. The DB stores this key rather than an absolute path, so the
 * uploads folder can move (new machine, Docker volume) without a data migration.
 */
export function documentStorageKey(userId: string, documentId: string): string {
  return `${userId}/${documentId}.pdf`;
}

/** Storage key for an image attached to a chat message. `extension` comes from the checked image format, never the upload's name. */
export function imageStorageKey(userId: string, attachmentId: string, extension: string): string {
  return `${userId}/images/${attachmentId}.${extension}`;
}

/** Absolute path for a storage key. Throws if the key would escape the upload root. */
export function resolveStorageKey(key: string): string {
  const root = uploadRoot();
  const absolute = path.resolve(root, ...key.split("/"));
  if (!absolute.startsWith(root + path.sep)) {
    throw new Error(`Storage key escapes the upload directory: ${key}`);
  }
  return absolute;
}

export async function saveFile(key: string, data: Uint8Array): Promise<void> {
  const absolute = resolveStorageKey(key);
  await mkdir(path.dirname(absolute), { recursive: true });
  // "wx" fails if the file exists — keys contain a fresh UUID, so a clash is a bug
  await writeFile(absolute, data, { flag: "wx" });
}

export async function readStoredFile(key: string): Promise<Buffer> {
  return readFile(resolveStorageKey(key));
}

/** Deletes a stored file. Missing files are ignored. */
export async function deleteFile(key: string): Promise<void> {
  await rm(resolveStorageKey(key), { force: true });
}

/**
 * Deletes stored files, logging failures instead of rejecting. For cleanup
 * once the database no longer points at them: a leftover file wastes space
 * but breaks nothing, so it shouldn't fail the request.
 */
export async function deleteFilesQuietly(keys: readonly string[]): Promise<void> {
  const results = await Promise.allSettled(keys.map(deleteFile));
  results.forEach((result, i) => {
    if (result.status === "rejected") {
      console.error("Failed to delete stored file", keys[i], result.reason);
    }
  });
}
