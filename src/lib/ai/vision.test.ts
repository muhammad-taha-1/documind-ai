import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { saveFile } from "@/lib/storage";
import {
  base64Length,
  chooseHistoryImages,
  type HistoryTurn,
  historyImageBudget,
  MAX_IMAGE_BYTES_PER_REQUEST,
  MAX_IMAGES_PER_REQUEST,
  type StoredImage,
  withHistoryImages,
} from "./vision";

const MB = 1024 * 1024;

function stored(id: string, byteSize = 1000, overrides: Partial<StoredImage> = {}): StoredImage {
  return { id, fileName: `${id}.png`, mediaType: "image/png", storageKey: `user/images/${id}.png`, byteSize, ...overrides };
}

const user = (images: StoredImage[], content = "q"): HistoryTurn => ({ role: "user", content, images });
const assistant = (content = "a"): HistoryTurn => ({ role: "assistant", content, images: [] });

describe("historyImageBudget", () => {
  it("leaves history what the new message's images don't use", () => {
    expect(historyImageBudget([])).toEqual({ images: MAX_IMAGES_PER_REQUEST, bytes: MAX_IMAGE_BYTES_PER_REQUEST });
    expect(historyImageBudget([{ byteSize: 3 }, { byteSize: 300 }])).toEqual({
      images: MAX_IMAGES_PER_REQUEST - 2,
      bytes: MAX_IMAGE_BYTES_PER_REQUEST - 4 - 400,
    });
  });

  it("counts images as base64, a third bigger", () => {
    expect(base64Length(3)).toBe(4);
    expect(base64Length(4)).toBe(8);
  });
});

describe("chooseHistoryImages", () => {
  it("sends every image when they fit", () => {
    const turns = [user([stored("a"), stored("b")]), assistant(), user([stored("c")])];
    expect(chooseHistoryImages(turns, historyImageBudget([]))).toEqual(new Set(["a", "b", "c"]));
  });

  it("keeps the newest images within the count limit", () => {
    const turns = [user([stored("a"), stored("b")]), assistant(), user([stored("c"), stored("d")])];
    expect(chooseHistoryImages(turns, { images: 3, bytes: MAX_IMAGE_BYTES_PER_REQUEST })).toEqual(
      new Set(["b", "c", "d"]),
    );
  });

  it("stops at the first image that doesn't fit the bytes, even if an older one would", () => {
    const turns = [user([stored("small", 10)]), assistant(), user([stored("big", 6 * MB)]), user([stored("new", 3 * MB)])];
    // 3 MB + 6 MB as base64 is 12 MB
    const chosen = chooseHistoryImages(turns, { images: 20, bytes: 8 * MB });
    expect(chosen).toEqual(new Set(["new"]));
  });

  it("sends none when the new message used the whole budget", () => {
    expect(chooseHistoryImages([user([stored("a")])], { images: 0, bytes: MAX_IMAGE_BYTES_PER_REQUEST })).toEqual(
      new Set(),
    );
  });
});

describe("withHistoryImages", () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "documind-vision-"));
    process.env.UPLOAD_DIR = root;
    await saveFile("user/images/a.png", Buffer.from("first image"));
    await saveFile("user/images/b.png", Buffer.from("second image"));
  });

  afterAll(async () => {
    delete process.env.UPLOAD_DIR;
    await rm(root, { recursive: true, force: true });
  });

  it("reads the images back from storage, and leaves turns without images as they were", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const turns = await withHistoryImages([user([stored("a"), stored("b")], "Compare these"), assistant("Done")], {
      images: 1,
      bytes: MAX_IMAGE_BYTES_PER_REQUEST,
    });

    expect(turns).toEqual([
      {
        role: "user",
        content: "Compare these",
        images: [
          // Over the count, so only the newer one goes
          { kind: "omitted", name: "a.png" },
          {
            kind: "image",
            name: "b.png",
            mediaType: "image/png",
            data: Buffer.from("second image").toString("base64"),
          },
        ],
      },
      { role: "assistant", content: "Done" },
    ]);
  });

  it("stands in a placeholder for a missing file or an unexpected type, without failing", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const turns = await withHistoryImages(
      [user([stored("gone"), stored("a", 1000, { mediaType: "image/svg+xml" })])],
      historyImageBudget([]),
    );

    expect(turns[0].images).toEqual([
      { kind: "omitted", name: "gone.png" },
      { kind: "omitted", name: "a.png" },
    ]);
    expect(consoleError).toHaveBeenCalledTimes(2);
    consoleError.mockRestore();
  });
});
