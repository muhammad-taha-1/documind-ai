"use client";

import { MessagesSquare, ScrollText } from "lucide-react";
import { Fragment, type ReactNode, useEffect, useLayoutEffect, useRef } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { ChatMessage, ConversationCompaction } from "@/types";
import { MessageBubble } from "./MessageBubble";

// How close to the bottom (px) still counts as "following along"
const STICK_THRESHOLD = 80;

/**
 * The scrolling message list. Keeps the newest message in view as messages
 * arrive — unless the user has scrolled up to read history, in which case it
 * leaves them where they are.
 */
export function ChatWindow({
  messages,
  compaction = null,
  isLoading = false,
  isStreaming = false,
  emptyState,
}: {
  messages: ChatMessage[];
  /** If set, marks where Claude's view of the conversation switches from the summary to the messages */
  compaction?: ConversationCompaction | null;
  /** Shows a placeholder reply while waiting for the assistant */
  isLoading?: boolean;
  /** A reply is still arriving. Screen readers wait for it to finish instead of reading every fragment. */
  isStreaming?: boolean;
  emptyState?: ReactNode;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  // Open at the latest message, before the first paint
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, []);

  const lastMessage = messages.at(-1);
  useEffect(() => {
    const element = scrollRef.current;
    // Sending a message always brings the conversation back into view
    if (lastMessage?.role === "user") {
      stickToBottom.current = true;
    }
    if (element && stickToBottom.current) {
      element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
    }
    // Re-runs when a message is added and as the last one grows (streaming)
  }, [messages.length, lastMessage?.role, lastMessage?.content, isLoading]);

  function handleScroll() {
    const element = scrollRef.current;
    if (!element) return;
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    stickToBottom.current = distanceFromBottom < STICK_THRESHOLD;
  }

  // The marker goes after the last message the summary covers
  const summarizedThrough = compaction ? Date.parse(compaction.through) : Number.NEGATIVE_INFINITY;
  const lastSummarized = messages.findLastIndex((message) => Date.parse(message.createdAt) <= summarizedThrough);

  if (messages.length === 0 && !isLoading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <MessagesSquare className="size-8 text-muted-foreground" />
        {emptyState ?? <p className="text-muted-foreground">Select documents and start chatting.</p>}
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="min-h-0 flex-1 overflow-y-auto"
      role="log"
      aria-label="Messages"
      aria-busy={isStreaming}
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
        {messages.map((message, i) => (
          <Fragment key={message.id}>
            <MessageBubble message={message} />
            {i === lastSummarized && compaction && <CompactionMarker summary={compaction.summary} />}
          </Fragment>
        ))}
        {isLoading && (
          <div className="grid gap-2" role="status" aria-label="Assistant is thinking">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Where Claude's view of the conversation changes: the messages above are
 * still shown here, but Claude now reads them only as this summary.
 */
function CompactionMarker({ summary }: { summary: string }) {
  return (
    <details className="group/summary rounded-md border border-dashed bg-muted/20 text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-2 text-muted-foreground [&::-webkit-details-marker]:hidden">
        <ScrollText className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1">
          Earlier messages summarized: Claude now remembers the conversation above as a summary
        </span>
        <span className="shrink-0 underline-offset-2 group-open/summary:hidden hover:underline">Show</span>
      </summary>
      <p className="border-t border-dashed px-3 py-2.5 leading-relaxed whitespace-pre-wrap">{summary}</p>
    </details>
  );
}
