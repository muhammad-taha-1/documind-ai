"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  MAX_IMAGES_PER_MESSAGE,
  sanitizeImageName,
  TOO_MANY_IMAGES_MESSAGE,
  validateImageFile,
} from "@/lib/chat/attachments";

/** An image attached to the message being written, not sent yet */
export interface DraftImage {
  id: string;
  file: File;
  name: string;
  /** A blob: URL for the thumbnail (and for the message while it's sending) */
  previewUrl: string;
}

/**
 * The images attached to the message being written. Each preview is a blob:
 * URL, which holds the file in memory until it's revoked, so this hook
 * tracks every URL it creates and revokes it once nothing shows it: when the
 * image is removed, after it's been sent and saved (`release`), or when the
 * chat is closed.
 *
 * Sending hands the images over with `take`, which empties the draft but
 * keeps the previews alive for the message on its way. If the send fails,
 * `restore` puts them back.
 */
export function useDraftImages() {
  const [images, setImages] = useState<DraftImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const liveUrls = useRef(new Set<string>());

  useEffect(() => {
    const urls = liveUrls.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  const revoke = useCallback((removed: readonly DraftImage[]) => {
    for (const image of removed) {
      URL.revokeObjectURL(image.previewUrl);
      liveUrls.current.delete(image.previewUrl);
    }
  }, []);

  /** Attaches what it can of `files` and says what it couldn't (one message at a time). */
  const add = useCallback(
    (files: readonly File[]) => {
      const accepted: DraftImage[] = [];
      let problem: string | null = null;
      for (const file of files) {
        const invalid = validateImageFile(file);
        if (invalid) {
          problem ??= invalid;
          continue;
        }
        if (images.length + accepted.length >= MAX_IMAGES_PER_MESSAGE) {
          problem = TOO_MANY_IMAGES_MESSAGE;
          break;
        }
        const previewUrl = URL.createObjectURL(file);
        liveUrls.current.add(previewUrl);
        accepted.push({ id: crypto.randomUUID(), file, name: sanitizeImageName(file.name), previewUrl });
      }
      setImages([...images, ...accepted]);
      setError(problem);
    },
    [images],
  );

  const remove = useCallback(
    (id: string) => {
      revoke(images.filter((image) => image.id === id));
      setImages(images.filter((image) => image.id !== id));
      setError(null);
    },
    [images, revoke],
  );

  /** Empties the draft for sending; the previews stay valid until `release` */
  const take = useCallback((): DraftImage[] => {
    setImages([]);
    setError(null);
    return images;
  }, [images]);

  /** Puts images back after a failed send, ahead of any attached since */
  const restore = useCallback((sent: readonly DraftImage[]) => {
    if (sent.length > 0) {
      setImages((current) => [...sent, ...current].slice(0, MAX_IMAGES_PER_MESSAGE));
    }
  }, []);

  const dismissError = useCallback(() => setError(null), []);

  return { images, error, add, remove, take, restore, release: revoke, dismissError };
}
