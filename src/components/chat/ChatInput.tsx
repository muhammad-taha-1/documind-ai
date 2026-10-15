"use client";

import { ArrowUp, Paperclip, X } from "lucide-react";
import { type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { DraftImage } from "@/hooks/useDraftImages";
import { IMAGE_MEDIA_TYPES, MAX_IMAGES_PER_MESSAGE } from "@/lib/chat/attachments";
import { MAX_MESSAGE_LENGTH } from "@/lib/chat/validation";

const ACCEPT = IMAGE_MEDIA_TYPES.join(",");

function hasFiles(event: DragEvent) {
  return event.dataTransfer.types.includes("Files");
}

/**
 * Message box that grows with its content (up to ~4 lines, then scrolls).
 * Enter sends; Shift+Enter starts a new line. Controlled, so the parent can
 * put a message back after a failed send.
 *
 * Images can be attached with the paperclip, pasted (screenshots), or
 * dropped onto the box. They show as thumbnails above the text, each with a
 * button to remove it. A message can be images alone.
 */
export function ChatInput({
  value,
  onValueChange,
  images,
  onAddImages,
  onRemoveImage,
  imageError,
  onSend,
  disabled = false,
  placeholder = "Ask a question about your documents…",
}: {
  value: string;
  onValueChange: (value: string) => void;
  images: readonly DraftImage[];
  onAddImages: (files: File[]) => void;
  onRemoveImage: (id: string) => void;
  /** Why the last images couldn't be attached */
  imageError: string | null;
  onSend: (message: string) => void;
  /** e.g. while the assistant is replying. The box stays typeable; only sending waits. */
  disabled?: boolean;
  placeholder?: string;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const canSend = !disabled && (value.trim().length > 0 || images.length > 0);
  const canAttach = images.length < MAX_IMAGES_PER_MESSAGE;

  function send() {
    if (!canSend) return;
    onSend(value.trim());
    onValueChange("");
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    send();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // isComposing: Enter also confirms IME input (e.g. Japanese) — don't send then
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files);
    if (files.length === 0) return;
    onAddImages(files);
    // Copying from some apps puts text and a picture of it on the clipboard:
    // let the text paste too, and only stop the default when there's none
    if (!event.clipboardData.types.includes("text/plain")) {
      event.preventDefault();
    }
  }

  function handleDragOver(event: DragEvent<HTMLFormElement>) {
    if (!hasFiles(event)) return;
    event.preventDefault(); // Allows the drop
    setDragging(true);
  }

  function handleDragLeave(event: DragEvent<HTMLFormElement>) {
    // Moving between the box's own children fires dragleave too
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setDragging(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLFormElement>) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    setDragging(false);
    onAddImages(Array.from(event.dataTransfer.files));
  }

  return (
    <div className="grid gap-1.5">
      <form
        onSubmit={handleSubmit}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        data-dragging={dragging || undefined}
        className="grid gap-2 rounded-2xl border border-input bg-card p-2 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 data-dragging:border-dashed data-dragging:border-ring data-dragging:bg-muted/50"
      >
        {images.length > 0 && (
          <ul aria-label="Attached images" className="flex flex-wrap gap-2 px-1 pt-1">
            {images.map((image) => (
              <li key={image.id} className="relative">
                {/* A local blob: preview, which the image optimizer can't fetch */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.previewUrl}
                  alt={image.name}
                  title={image.name}
                  className="size-16 rounded-lg border object-cover"
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="icon-xs"
                  onClick={() => onRemoveImage(image.id)}
                  aria-label={`Remove ${image.name}`}
                  className="absolute -top-1.5 -right-1.5 rounded-full border shadow-sm"
                >
                  <X />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPT}
            multiple
            hidden
            onChange={(event) => {
              onAddImages(Array.from(event.target.files ?? []));
              // So picking the same file again (after removing it) still fires a change
              event.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => fileInput.current?.click()}
            disabled={!canAttach}
            aria-label="Attach images"
            title={canAttach ? "Attach images (PNG, JPEG, GIF or WebP, up to 5 MB)" : `Up to ${MAX_IMAGES_PER_MESSAGE} images`}
            className="rounded-xl text-muted-foreground"
          >
            <Paperclip />
          </Button>
          <label htmlFor="chat-input" className="sr-only">
            Message
          </label>
          <textarea
            id="chat-input"
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={placeholder}
            maxLength={MAX_MESSAGE_LENGTH}
            rows={1}
            className="field-sizing-content max-h-[calc(4lh+1rem)] min-h-9 flex-1 resize-none bg-transparent px-1 py-2 text-sm outline-none placeholder:text-muted-foreground"
          />
          <Button
            type="submit"
            size="icon"
            disabled={!canSend}
            aria-label="Send message"
            className="rounded-xl"
          >
            <ArrowUp />
          </Button>
        </div>
      </form>
      {imageError && (
        <p role="alert" className="px-2 text-xs text-destructive">
          {imageError}
        </p>
      )}
    </div>
  );
}
