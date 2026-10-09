"use client";

import { MessagesSquare } from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useRef } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import type { ChatMessage } from "@/types";
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
  isLoading = false,
  emptyState,
}: {
  messages: ChatMessage[];
  /** Shows a placeholder reply while waiting for the assistant */
  isLoading?: boolean;
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
    if (element && stickToBottom.current) {
      element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
    }
    // Re-runs when a message is added and as the last one grows (streaming)
  }, [messages.length, lastMessage?.content, isLoading]);

  function handleScroll() {
    const element = scrollRef.current;
    if (!element) return;
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    stickToBottom.current = distanceFromBottom < STICK_THRESHOLD;
  }

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
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
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
