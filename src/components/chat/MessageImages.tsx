"use client";

import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { ChatAttachment } from "@/types";

// Plain <img> throughout: images come from an authenticated API route (or a
// local blob: preview while sending), neither of which the image optimizer
// can fetch on the user's behalf.

/**
 * The images on a user message: one shown large, several as a grid of
 * thumbnails. Clicking one opens it full size.
 */
export function MessageImages({ attachments }: { attachments: readonly ChatAttachment[] }) {
  const [viewing, setViewing] = useState<ChatAttachment | null>(null);
  const single = attachments.length === 1;

  return (
    <>
      <ul aria-label="Attached images" className="flex max-w-[85%] flex-wrap justify-end gap-2">
        {attachments.map((attachment) => (
          <li key={attachment.id}>
            <button
              type="button"
              onClick={() => setViewing(attachment)}
              aria-label={`View ${attachment.name} full size`}
              className="block overflow-hidden rounded-xl border bg-muted/50 outline-none hover:opacity-90 focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={attachment.url}
                alt={attachment.name}
                // Reserves the space before the image loads, so the chat doesn't jump
                width={attachment.width ?? undefined}
                height={attachment.height ?? undefined}
                className={single ? "h-auto max-h-72 w-auto max-w-full object-contain" : "size-32 object-cover"}
              />
            </button>
          </li>
        ))}
      </ul>

      <Dialog open={viewing !== null} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)] sm:max-w-[min(calc(100vw-2rem),80rem)]">
          {viewing && (
            <>
              <div className="flex min-w-0 items-center gap-3 pr-8">
                <DialogTitle className="truncate">{viewing.name}</DialogTitle>
                <a
                  href={viewing.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <ExternalLink className="size-3.5" />
                  Open in new tab
                </a>
              </div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={viewing.url}
                alt={viewing.name}
                width={viewing.width ?? undefined}
                height={viewing.height ?? undefined}
                className="mx-auto h-auto max-h-full w-auto max-w-full min-h-0 rounded-lg object-contain"
              />
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
