import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteFile, documentStorageKey, resolveStorageKey, saveFile } from "./storage";

let root: string;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "documind-storage-"));
  process.env.UPLOAD_DIR = root;
});

afterAll(async () => {
  delete process.env.UPLOAD_DIR;
  await rm(root, { recursive: true, force: true });
});

describe("document storage", () => {
  it("builds keys as userId/documentId.pdf", () => {
    expect(documentStorageKey("user1", "doc1")).toBe("user1/doc1.pdf");
  });

  it("resolves keys inside the upload root", () => {
    expect(resolveStorageKey("user1/doc1.pdf")).toBe(path.join(root, "user1", "doc1.pdf"));
  });

  it.each(["../outside.pdf", "user1/../../outside.pdf", "..", ""])(
    "refuses keys that escape the root: %j",
    (key) => {
      expect(() => resolveStorageKey(key)).toThrow(/escapes/);
    },
  );

  it("saves, refuses to overwrite, and deletes files", async () => {
    const key = "user1/doc2.pdf";
    await saveFile(key, new TextEncoder().encode("%PDF-1.7"));
    expect(await readFile(resolveStorageKey(key), "utf8")).toBe("%PDF-1.7");

    await expect(saveFile(key, new Uint8Array([1]))).rejects.toThrow();

    await deleteFile(key);
    await expect(readFile(resolveStorageKey(key))).rejects.toThrow();
    // Deleting a missing file is not an error
    await expect(deleteFile(key)).resolves.toBeUndefined();
  });
});
