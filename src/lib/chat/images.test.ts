import { crc32 } from "node:zlib";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

const saveFile = vi.hoisted(() => vi.fn<(key: string, data: Uint8Array) => Promise<void>>());
const deleteFilesQuietly = vi.hoisted(() => vi.fn<(keys: readonly string[]) => Promise<void>>());
vi.mock("@/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage")>()),
  saveFile,
  deleteFilesQuietly,
}));

const {
  MAX_STORED_IMAGE_BYTES,
  MAX_VISION_EDGE,
  MAX_VISION_TOKENS,
  normalizeImage,
  storeImages,
  visionSize,
  visionTokens,
} = await import("./images");

/** A solid-colour image in the given format */
function solid(width: number, height: number, format: "png" | "jpeg" | "webp" | "gif") {
  return sharp({ create: { width, height, channels: 3, background: { r: 40, g: 120, b: 200 } } })
    .toFormat(format)
    .toBuffer();
}

/** Random pixels: the worst case for compression */
function noise(width: number, height: number) {
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < pixels.length; i++) pixels[i] = Math.floor(Math.random() * 256);
  return sharp(pixels, { raw: { width, height, channels: 3 } });
}

/** A tiny PNG whose header claims a much bigger size: what a "decompression bomb" looks like before decoding */
async function pngClaiming(width: number, height: number) {
  const png = Buffer.from(await solid(8, 8, "png"));
  // The IHDR chunk's data (width, height, ...) starts after the signature, length and type
  png.writeUInt32BE(width, 16);
  png.writeUInt32BE(height, 20);
  png.writeUInt32BE(crc32(png.subarray(12, 29)), 29);
  return png;
}

async function normalized(bytes: Buffer, name = "image.png") {
  const result = await normalizeImage(bytes, name);
  if (!result.ok) throw new Error(`Expected the image to be accepted, got ${result.reason}`);
  return result.image;
}

describe("visionSize", () => {
  it("leaves images Claude sees whole at their size", () => {
    expect(visionSize(200, 200)).toEqual({ width: 200, height: 200 });
    // Claude's docs: 1920×1080 isn't resized on high-resolution models
    expect(visionSize(1920, 1080)).toEqual({ width: 1920, height: 1080 });
  });

  it("scales a 4K screenshot to what Claude's docs say it becomes", () => {
    expect(visionSize(3840, 2160)).toEqual({ width: 2576, height: 1449 });
    expect(visionTokens(2576, 1449)).toBe(MAX_VISION_TOKENS);
  });

  it("keeps square and tall images within both limits, with their proportions", () => {
    for (const [width, height] of [
      [4000, 4000],
      [1000, 9000],
      [2000, 2000],
    ]) {
      const size = visionSize(width, height);
      expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(MAX_VISION_EDGE);
      expect(visionTokens(size.width, size.height)).toBeLessThanOrEqual(MAX_VISION_TOKENS);
      expect(size.width / size.height).toBeCloseTo(width / height, 1);
      // ...without shrinking more than it has to: one of the limits is (nearly) reached
      const atEdge = Math.max(size.width, size.height) === MAX_VISION_EDGE;
      expect(atEdge || visionTokens(size.width + 28, size.height + 28) > MAX_VISION_TOKENS).toBe(true);
    }
  });
});

describe("normalizeImage", () => {
  it("keeps a small PNG as a PNG of the same size", async () => {
    const image = await normalized(await solid(300, 200, "png"), "chart.png");
    expect(image).toMatchObject({ name: "chart.png", mediaType: "image/png", width: 300, height: 200 });
    const stored = await sharp(image.data).metadata();
    expect([stored.format, stored.width, stored.height]).toEqual(["png", 300, 200]);
  });

  it("scales down what's bigger than Claude can see", async () => {
    const image = await normalized(await solid(4000, 3000, "jpeg"));
    expect(image.mediaType).toBe("image/jpeg");
    expect(visionTokens(image.width, image.height)).toBeLessThanOrEqual(MAX_VISION_TOKENS);
    const stored = await sharp(image.data).metadata();
    expect([stored.width, stored.height]).toEqual([image.width, image.height]);
  });

  it("applies a phone photo's EXIF rotation to the pixels, and drops the metadata", async () => {
    // Stored 400 wide, 200 high, with "rotate 90° clockwise to display" (orientation 6)
    const photo = await sharp(await solid(400, 200, "jpeg"))
      .withMetadata({ orientation: 6, exif: { IFD0: { Copyright: "secret" } } })
      .jpeg()
      .toBuffer();
    expect((await sharp(photo).metadata()).orientation).toBe(6);

    const image = await normalized(photo, "photo.jpg");

    expect([image.width, image.height]).toEqual([200, 400]);
    const stored = await sharp(image.data).metadata();
    expect([stored.width, stored.height, stored.orientation, stored.exif]).toEqual([200, 400, undefined, undefined]);
  });

  it("stores a GIF's first frame as a PNG", async () => {
    const image = await normalized(await solid(50, 40, "gif"), "anim.gif");
    expect(image.mediaType).toBe("image/png");
    expect((await sharp(image.data).metadata()).format).toBe("png");
  });

  it("keeps WebP as WebP", async () => {
    const image = await normalized(await solid(64, 64, "webp"));
    expect(image.mediaType).toBe("image/webp");
  });

  it("re-encodes a photo saved as PNG as JPEG when the PNG would be too big", async () => {
    const png = await noise(1500, 1500).png().toBuffer();
    expect(png.byteLength).toBeGreaterThan(MAX_STORED_IMAGE_BYTES);

    const image = await normalized(png);

    expect(image.mediaType).toBe("image/jpeg");
    expect(image.data.byteLength).toBeLessThanOrEqual(MAX_STORED_IMAGE_BYTES);
  });

  it("goes by the content, not the name: other formats are turned away", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
    expect(await normalizeImage(svg, "logo.png")).toEqual({ ok: false, reason: "unsupported" });
    const tiff = await sharp(await solid(10, 10, "png")).tiff().toBuffer();
    expect(await normalizeImage(tiff, "scan.jpg")).toEqual({ ok: false, reason: "unsupported" });
  });

  it("rejects files that aren't images, or are damaged", async () => {
    expect(await normalizeImage(Buffer.from("%PDF-1.7 not an image"), "doc.png")).toEqual({
      ok: false,
      reason: "unreadable",
    });
    const png = await noise(200, 200).png().toBuffer();
    expect(await normalizeImage(png.subarray(0, png.byteLength / 2), "cut.png")).toEqual({
      ok: false,
      reason: "unreadable",
    });
  });

  it("rejects images with more pixels than the API accepts, without decoding them", async () => {
    expect(await normalizeImage(await pngClaiming(9000, 9000), "huge.png")).toEqual({ ok: false, reason: "too_large" });
  });
});

describe("storeImages", () => {
  beforeEach(() => {
    saveFile.mockReset().mockResolvedValue();
    deleteFilesQuietly.mockReset().mockResolvedValue();
  });

  const image = (name: string, mediaType: "image/png" | "image/jpeg") => ({
    name,
    data: Buffer.from(name),
    mediaType,
    width: 10,
    height: 20,
  });

  it("stores each image under the user's images, named by a fresh ID and its real format", async () => {
    const attachments = await storeImages("user-1", [image("a.gif", "image/png"), image("b.jpeg", "image/jpeg")]);

    expect(attachments).toEqual([
      expect.objectContaining({ position: 1, fileName: "a.gif", mediaType: "image/png", width: 10, height: 20, byteSize: 5 }),
      expect.objectContaining({ position: 2, fileName: "b.jpeg", mediaType: "image/jpeg", byteSize: 6 }),
    ]);
    expect(attachments[0].storageKey).toBe(`user-1/images/${attachments[0].id}.png`);
    expect(attachments[1].storageKey).toBe(`user-1/images/${attachments[1].id}.jpg`);
    expect(attachments[0].id).not.toBe(attachments[1].id);
    expect(saveFile.mock.calls.map(([key]) => key)).toEqual(attachments.map((a) => a.storageKey));
  });

  it("removes the images it did store if one fails", async () => {
    const failure = new Error("disk full");
    saveFile.mockResolvedValueOnce().mockRejectedValueOnce(failure);

    await expect(storeImages("user-1", [image("a.png", "image/png"), image("b.png", "image/png")])).rejects.toBe(
      failure,
    );
    const keys = saveFile.mock.calls.map(([key]) => key);
    expect(deleteFilesQuietly).toHaveBeenCalledWith(keys);
  });
});
