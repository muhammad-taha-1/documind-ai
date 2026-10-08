import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

// Uploaded files live outside `public/`, so they're never served directly —
// any future download/view route must check ownership first.
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

/** Deletes a stored file. Missing files are ignored. */
export async function deleteFile(key: string): Promise<void> {
  await rm(resolveStorageKey(key), { force: true });
}
