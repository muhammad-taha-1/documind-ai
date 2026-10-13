"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseApiError } from "@/lib/api";
import { readNdjson } from "@/lib/chat/stream";
import type { ChatMessage, ChatStreamEvent, ConversationSummary, RetryReason, ToolCall } from "@/types";

/** A message on its way: shown straight away, with the reply filling in as it streams. */
export interface PendingExchange {
  userMessage: ChatMessage;
  /** The reply so far ("" until the first text arrives) */
  reply: string;
  /** Tools Claude is using or has used for this reply, in call order */
  toolCalls: ToolCall[];
  /**
   * Set when the server is waiting to retry because Claude is busy, with the
   * time it will try again (ms since the epoch). Cleared when the reply moves on.
   */
  retry: { reason: RetryReason; retryAt: number } | null;
}

/** Adds a tool call, or replaces it with its latest state (running, then done or failed). */
function upsertToolCall(calls: ToolCall[], call: ToolCall): ToolCall[] {
  return calls.some((existing) => existing.id === call.id)
    ? calls.map((existing) => (existing.id === call.id ? call : existing))
    : [...calls, call];
}

const NETWORK_ERROR = "Couldn't reach the server. Check your connection and try again.";
const INTERRUPTED_ERROR = "The reply was interrupted. Please try again.";

/**
 * Chat state for one conversation: saved messages, the exchange in flight,
 * and the last error. Sends go to POST /api/chat and the reply streams in.
 *
 * Nothing is saved unless the reply completes, so on failure the pending
 * message is dropped and `sendMessage` resolves false — the caller can put
 * the text back in the input for another try.
 */
export function useChat({
  conversationId,
  initialMessages,
  onConversationChange,
}: {
  conversationId: string;
  initialMessages: ChatMessage[];
  /** Called with the updated conversation (title, activity time) after each exchange */
  onConversationChange?: (conversation: ConversationSummary) => void;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [pending, setPending] = useState<PendingExchange | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<AbortController | null>(null);

  // Leaving the chat abandons the reply; the server stops generating it
  useEffect(() => () => inFlight.current?.abort(), []);

  /** Resolves true once the exchange is saved, false if it failed. */
  const sendMessage = useCallback(
    async (content: string): Promise<boolean> => {
      if (inFlight.current) {
        return false; // One exchange at a time
      }
      const controller = new AbortController();
      inFlight.current = controller;
      setError(null);
      setPending({
        userMessage: {
          id: `pending-${crypto.randomUUID()}`,
          role: "user",
          content,
          createdAt: new Date().toISOString(),
          retrieval: null,
          sources: [],
          toolCalls: [],
          usage: null,
        },
        reply: "",
        toolCalls: [],
        retry: null,
      });

      try {
        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ conversationId, message: content }),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          setError(parseApiError(await response.text(), "Couldn't send your message. Please try again."));
          return false;
        }

        // Our own server's format (see ChatStreamEvent)
        for await (const event of readNdjson(response.body) as AsyncGenerator<ChatStreamEvent>) {
          switch (event.type) {
            case "delta":
              setPending((current) => current && { ...current, reply: current.reply + event.text, retry: null });
              break;
            case "tool":
              setPending(
                (current) =>
                  current && { ...current, toolCalls: upsertToolCall(current.toolCalls, event.call), retry: null },
              );
              break;
            case "retry":
              setPending(
                (current) =>
                  current && { ...current, retry: { reason: event.reason, retryAt: Date.now() + event.delayMs } },
              );
              break;
            case "done":
              setMessages((current) => [...current, event.userMessage, event.assistantMessage]);
              onConversationChange?.(event.conversation);
              return true;
            case "error":
              setError(event.error);
              return false;
          }
        }
        // The stream ended without a result, e.g. the connection dropped
        setError(INTERRUPTED_ERROR);
        return false;
      } catch {
        if (!controller.signal.aborted) {
          setError(NETWORK_ERROR);
        }
        return false;
      } finally {
        inFlight.current = null;
        if (!controller.signal.aborted) {
          setPending(null);
        }
      }
    },
    [conversationId, onConversationChange],
  );

  const dismissError = useCallback(() => setError(null), []);

  return { messages, pending, error, dismissError, sendMessage };
}
