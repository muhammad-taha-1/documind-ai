import { randomUUID } from "node:crypto";
import sharp, { type Metadata, type Sharp, type SharpOptions } from "sharp";
import { deleteFilesQuietly, imageStorageKey, saveFile } from "@/lib/storage";
import type { ImageMediaType } from "./attachments";

// Images attached in chat are re-encoded before they're stored or sent:
//
// - The upload's MIME type and name are chosen by the client, so the format
//   is read from the content. Anything that isn't really PNG, JPEG, GIF or
//   WebP (SVG with scripts, HEIC, a renamed PDF) is turned away.
// - Phone photos are often stored sideways with an EXIF "rotate me" tag.
//   Claude doesn't read metadata, so the rotation is applied to the pixels.
// - Claude scales anything bigger than it can see down to fit, so storing the
//   full size would only make every request heavier. Each image is sent again
//   with every later message (see vision.ts), so bytes add up.
// - Metadata is dropped: photos can carry GPS coordinates, and these files are
//   kept and served back.

/** The most Claude takes in: images beyond either limit are scaled down (docs: Vision → resolution) */
export const MAX_VISION_EDGE = 2576;
export const MAX_VISION_TOKENS = 4784;
/** Claude reads images in 28×28-pixel patches, one token each */
const PATCH_SIZE = 28;

/** The API rejects images over 8000×8000; this also stops "decompression bomb" files */
const MAX_INPUT_PIXELS = 8000 * 8000;

/**
 * Largest file stored after re-encoding. 5 MB once base64-encoded, so even
 * MAX_IMAGES_PER_MESSAGE of them stay well inside the request size limit.
 */
export const MAX_STORED_IMAGE_BYTES = Math.floor((5 * 1024 * 1024 * 3) / 4);

const OUTPUT_FORMATS = {
  png: { mediaType: "image/png", extension: "png" },
  jpeg: { mediaType: "image/jpeg", extension: "jpg" },
  webp: { mediaType: "image/webp", extension: "webp" },
} as const satisfies Record<string, { mediaType: ImageMediaType; extension: string }>;

type OutputFormat = keyof typeof OUTPUT_FORMATS;

/**
 * What each accepted format is stored as. GIF becomes PNG: animation isn't
 * supported (Claude sees the first frame), and PNG keeps its sharp edges.
 */
const STORED_FORMAT: Record<string, OutputFormat> = { png: "png", jpeg: "jpeg", webp: "webp", gif: "png" };

const EXTENSIONS: Record<ImageMediaType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** Visual tokens an image of this size costs */
export function visionTokens(width: number, height: number): number {
  return Math.ceil(width / PATCH_SIZE) * Math.ceil(height / PATCH_SIZE);
}

/**
 * The size an image is stored at: the original if Claude would see it whole,
 * otherwise the largest size with the same proportions that fits both of
 * Claude's limits (the long edge, and the number of patches).
 */
export function visionSize(width: number, height: number): { width: number; height: number } {
  let scale = Math.min(
    1,
    MAX_VISION_EDGE / Math.max(width, height),
    Math.sqrt((MAX_VISION_TOKENS * PATCH_SIZE * PATCH_SIZE) / (width * height)),
  );
  const fit = () => ({
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  });
  let size = fit();
  // Patches round up, so the area estimate can land a row or column over
  while (visionTokens(size.width, size.height) > MAX_VISION_TOKENS) {
    scale *= 0.99;
    size = fit();
  }
  return size;
}

export interface NormalizedImage {
  /** Display name (sanitized) */
  name: string;
  data: Buffer;
  mediaType: ImageMediaType;
  width: number;
  height: number;
}

export type NormalizeImageResult =
  | { ok: true; image: NormalizedImage }
  /** unsupported: not one of the four formats; unreadable: corrupt or truncated; too_large: too many pixels, or too big even as JPEG */
  | { ok: false; reason: "unsupported" | "unreadable" | "too_large" };

function encode(pipeline: Sharp, format: OutputFormat): Promise<Buffer> {
  switch (format) {
    case "png":
      return pipeline.png().toBuffer();
    case "jpeg":
      // Full-resolution colour (no 4:2:0 subsampling) keeps small text legible
      return pipeline.jpeg({ quality: 90, chromaSubsampling: "4:4:4", mozjpeg: true }).toBuffer();
    case "webp":
      return pipeline.webp({ quality: 90 }).toBuffer();
  }
}

/** Checks an uploaded image and re-encodes it for storing and sending (see the top of this file). */
export async function normalizeImage(bytes: Uint8Array, name: string): Promise<NormalizeImageResult> {
  // The default failOn ("warning") is the one sharp recommends for untrusted input
  const options = { limitInputPixels: MAX_INPUT_PIXELS, autoOrient: true } satisfies SharpOptions;

  let metadata: Metadata;
  try {
    // Reads only the header, so no limit is needed yet. (With one, an image
    // over it fails here as an error we couldn't tell apart from a damaged file.)
    metadata = await sharp(bytes, { ...options, limitInputPixels: false }).metadata();
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  const format = STORED_FORMAT[metadata.format];
  if (!format) {
    return { ok: false, reason: "unsupported" };
  }
  if (metadata.width * metadata.height > MAX_INPUT_PIXELS) {
    return { ok: false, reason: "too_large" };
  }

  // Width and height as displayed, i.e. after applying the EXIF rotation
  const { width, height } = metadata.autoOrient;
  const size = visionSize(width, height);
  const resized = () => {
    const pipeline = sharp(bytes, options);
    // visionSize kept the proportions, so stretching to exactly this size is safe
    return size.width === width && size.height === height
      ? pipeline
      : pipeline.resize(size.width, size.height, { fit: "fill" });
  };

  try {
    let output: OutputFormat = format;
    let data = await encode(resized(), output);
    if (data.byteLength > MAX_STORED_IMAGE_BYTES && output !== "jpeg") {
      // A photo saved as PNG can be huge at full size. JPEG has no transparency,
      // so transparent areas become white rather than black.
      output = "jpeg";
      data = await encode(resized().flatten({ background: "#ffffff" }), output);
    }
    if (data.byteLength > MAX_STORED_IMAGE_BYTES) {
      return { ok: false, reason: "too_large" };
    }
    return {
      ok: true,
      image: { name, data, mediaType: OUTPUT_FORMATS[output].mediaType, ...size },
    };
  } catch {
    // e.g. a truncated file: the header reads fine, the pixels don't
    return { ok: false, reason: "unreadable" };
  }
}

/** An attachment ready to be saved with its message; its file is already stored */
export interface NewAttachment {
  id: string;
  /** 1-based, in the order the user attached them */
  position: number;
  fileName: string;
  mediaType: ImageMediaType;
  storageKey: string;
  width: number;
  height: number;
  byteSize: number;
}

/**
 * Writes a message's images to storage. Done once the reply has succeeded,
 * just before the message is saved; if saving fails, the caller removes
 * them again. All or nothing: if one write fails, the others are removed.
 */
export async function storeImages(userId: string, images: readonly NormalizedImage[]): Promise<NewAttachment[]> {
  const attachments = images.map((image, i): NewAttachment => {
    const id = randomUUID();
    return {
      id,
      position: i + 1,
      fileName: image.name,
      mediaType: image.mediaType,
      storageKey: imageStorageKey(userId, id, EXTENSIONS[image.mediaType]),
      width: image.width,
      height: image.height,
      byteSize: image.data.byteLength,
    };
  });
  const writes = await Promise.allSettled(
    attachments.map((attachment, i) => saveFile(attachment.storageKey, images[i].data)),
  );
  const failed = writes.find((write) => write.status === "rejected");
  if (failed) {
    await deleteFilesQuietly(attachments.map((attachment) => attachment.storageKey));
    throw failed.reason;
  }
  return attachments;
}
