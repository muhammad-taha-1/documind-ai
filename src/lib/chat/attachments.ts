// Rules for images attached to chat messages, shared by the browser (fast
// feedback) and the API (enforcement). Free of Node imports so client
// components can use it.

/** The formats Claude can read */
export const IMAGE_MEDIA_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;

export type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];

export const MAX_IMAGES_PER_MESSAGE = 4;

/** Largest image a user can attach, before it's resized */
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB

const MAX_FILE_NAME_LENGTH = 255;

export function isImageMediaType(value: string): value is ImageMediaType {
  return (IMAGE_MEDIA_TYPES as readonly string[]).includes(value);
}

export const UNSUPPORTED_IMAGE_MESSAGE = "Only PNG, JPEG, GIF and WebP images can be attached.";
export const TOO_MANY_IMAGES_MESSAGE = `You can attach up to ${MAX_IMAGES_PER_MESSAGE} images to a message.`;

export function imageTooLargeMessage(name: string): string {
  return `${name} is too large. Images can be up to 5 MB.`;
}

/**
 * Client-side pre-check of a picked, pasted or dropped file. Returns an error
 * message, or null if it looks OK. The server checks the actual content.
 */
export function validateImageFile(file: Pick<File, "name" | "size" | "type">): string | null {
  if (!isImageMediaType(file.type)) {
    return UNSUPPORTED_IMAGE_MESSAGE;
  }
  if (file.size === 0) {
    return `${file.name} is empty.`;
  }
  if (file.size > MAX_IMAGE_SIZE) {
    return imageTooLargeMessage(file.name);
  }
  return null;
}

/**
 * The name to store for display: no directory parts, bounded length. Never
 * used in paths. Pasted screenshots often arrive as plain "image.png".
 */
export function sanitizeImageName(name: string): string {
  const baseName = name.split(/[\\/]/).pop()?.replace(/\s+/g, " ").trim() ?? "";
  return (baseName || "image").slice(0, MAX_FILE_NAME_LENGTH);
}

/** Where the browser loads an attached image from (an authenticated route) */
export function attachmentPath(attachmentId: string): string {
  return `/api/attachments/${encodeURIComponent(attachmentId)}`;
}
