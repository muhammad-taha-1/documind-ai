import { isImageMediaType } from "@/lib/chat/attachments";
import type { NormalizedImage } from "@/lib/chat/images";
import { readStoredFile } from "@/lib/storage";
import type { ChatTurn, TurnImage } from "./chat";

// Images in the conversation history. The API is stateless, so an image
// Claude should still see in later turns has to be sent again with every
// message. That's what lets follow-ups work ("what's the third bar?"), and
// it's cheap: an image that went out last turn is read from the prompt
// cache like the rest of the history. Compaction (context.ts) bounds the
// conversation's tokens, images included, and folds old images into the
// summary as descriptions.
//
// What compaction doesn't bound is bytes: the API caps a request at 32 MB,
// and base64 makes images a third bigger. So images are sent newest first,
// up to a budget, and anything older becomes a placeholder. The cut only
// moves when a new image arrives, so the prompt stays a stable prefix
// between those turns.

/**
 * At most this many images in one request. Above 20, the API rejects any
 * image over 2000 pixels on a side, and stored images can be up to 2576.
 */
export const MAX_IMAGES_PER_REQUEST = 20;

/** Base64 bytes of images per request: well under the 32 MB request cap, leaving room for the text */
export const MAX_IMAGE_BYTES_PER_REQUEST = 20 * 1024 * 1024;

/** An image saved with an earlier message */
export interface StoredImage {
  id: string;
  fileName: string;
  mediaType: string;
  storageKey: string;
  byteSize: number;
}

/** A saved message, as history needs it: its images are still files on disk */
export interface HistoryTurn {
  role: ChatTurn["role"];
  content: string;
  images: StoredImage[];
}

export interface ImageBudget {
  images: number;
  bytes: number;
}

export function base64Length(byteLength: number): number {
  return 4 * Math.ceil(byteLength / 3);
}

/** The budget left for history once the new message's own images are counted */
export function historyImageBudget(newImages: readonly { byteSize: number }[]): ImageBudget {
  return {
    images: MAX_IMAGES_PER_REQUEST - newImages.length,
    bytes: newImages.reduce((left, image) => left - base64Length(image.byteSize), MAX_IMAGE_BYTES_PER_REQUEST),
  };
}

/**
 * The IDs of the stored images to send: the newest ones, until the next one
 * doesn't fit the budget. Everything older than that is left out too, even
 * if a smaller one would fit, so the cut is a single point in the history.
 */
export function chooseHistoryImages(turns: readonly HistoryTurn[], budget: ImageBudget): Set<string> {
  const chosen = new Set<string>();
  let bytes = 0;
  for (let t = turns.length - 1; t >= 0; t--) {
    const { images } = turns[t];
    for (let i = images.length - 1; i >= 0; i--) {
      const size = base64Length(images[i].byteSize);
      if (chosen.size + 1 > budget.images || bytes + size > budget.bytes) {
        return chosen;
      }
      chosen.add(images[i].id);
      bytes += size;
    }
  }
  return chosen;
}

async function loadImage(image: StoredImage, include: boolean): Promise<TurnImage> {
  const omitted: TurnImage = { kind: "omitted", name: image.fileName };
  if (!include) {
    return omitted;
  }
  if (!isImageMediaType(image.mediaType)) {
    console.error(`Attachment ${image.id} has an unexpected media type: ${image.mediaType}`);
    return omitted;
  }
  try {
    const data = await readStoredFile(image.storageKey);
    return { kind: "image", name: image.fileName, mediaType: image.mediaType, data: data.toString("base64") };
  } catch (error) {
    // A missing file shouldn't cost the user their reply: Claude is told it's not there
    console.error(`Attachment ${image.id} couldn't be read`, error);
    return omitted;
  }
}

/** History turns with their images read back from storage, as far as `budget` allows. */
export async function withHistoryImages(turns: readonly HistoryTurn[], budget: ImageBudget): Promise<ChatTurn[]> {
  const chosen = chooseHistoryImages(turns, budget);
  const total = turns.reduce((count, turn) => count + turn.images.length, 0);
  if (chosen.size < total) {
    console.info(`Sending ${chosen.size} of ${total} earlier images; the older ones are placeholders`);
  }
  return Promise.all(
    turns.map(async ({ role, content, images }): Promise<ChatTurn> =>
      images.length === 0
        ? { role, content }
        : { role, content, images: await Promise.all(images.map((image) => loadImage(image, chosen.has(image.id)))) },
    ),
  );
}

/** The images of the message being sent, which always go in full */
export function toTurnImages(images: readonly NormalizedImage[]): TurnImage[] {
  return images.map((image) => ({
    kind: "image",
    name: image.name,
    mediaType: image.mediaType,
    data: image.data.toString("base64"),
  }));
}
