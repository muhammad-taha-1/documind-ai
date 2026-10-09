"use client";

import { CircleAlert, FileText, X } from "lucide-react";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useChat } from "@/hooks/useChat";
import type { ChatMessage, ConversationDetail } from "@/types";
import { ChatInput } from "./ChatInput";
import { ChatWindow } from "./ChatWindow";
import { useConversations } from "./ConversationsProvider";

/** A conversation: title, messages, and the input with its documents above it. */
export function ChatView({ conversation }: { conversation: ConversationDetail }) {
  const { conversations, upsertConversation } = useConversations();
  const { messages, pending, error, dismissError, sendMessage } = useChat({
    conversationId: conversation.id,
    initialMessages: conversation.messages,
    onConversationChange: upsertConversation,
  });
  const [draft, setDraft] = useState("");

  // The first exchange renames the chat; the sidebar's copy has the latest title
  const title = conversations.find((c) => c.id === conversation.id)?.title ?? conversation.title;

  async function handleSend(content: string) {
    const sent = await sendMessage(content);
    if (!sent) {
      // Nothing was saved — give the text back, unless they've started typing again
      setDraft((current) => (current.trim() ? current : content));
    }
  }

  // The exchange in flight is shown as if saved; the reply bubble appears with its first text
  const displayed: ChatMessage[] = pending
    ? [
        ...messages,
        pending.userMessage,
        ...(pending.reply
          ? [
              {
                id: "streaming-reply",
                role: "assistant" as const,
                content: pending.reply,
                createdAt: pending.userMessage.createdAt,
              },
            ]
          : []),
      ]
    : messages;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center border-b px-4">
        <h1 className="truncate font-medium">{title}</h1>
      </header>

      <ChatWindow
        messages={displayed}
        isLoading={pending !== null && !pending.reply}
        isStreaming={pending !== null}
        emptyState={
          <div className="grid gap-1">
            <p className="font-medium">Ask anything about your documents</p>
            <p className="text-sm text-muted-foreground">Answers come from the documents below.</p>
          </div>
        }
      />

      <div className="mx-auto grid w-full max-w-3xl gap-2 px-4 pb-4">
        {error && (
          <Alert variant="destructive" className="pr-10">
            <CircleAlert />
            <AlertDescription>{error}</AlertDescription>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={dismissError}
              aria-label="Dismiss error"
              className="absolute top-2 right-2"
            >
              <X />
            </Button>
          </Alert>
        )}
        <ul aria-label="Documents in this chat" className="flex flex-wrap gap-1.5">
          {conversation.documents.map((document) => (
            <li
              key={document.id}
              className="flex max-w-60 items-center gap-1.5 rounded-md border bg-muted/50 px-2 py-1 text-xs text-muted-foreground"
              title={document.title}
            >
              <FileText className="size-3.5 shrink-0" />
              <span className="truncate">{document.title}</span>
            </li>
          ))}
          {conversation.documents.length === 0 && (
            <li className="text-xs text-muted-foreground">
              The documents in this chat have been deleted.
            </li>
          )}
        </ul>
        <ChatInput
          value={draft}
          onValueChange={setDraft}
          onSend={handleSend}
          disabled={pending !== null}
        />
      </div>
    </div>
  );
}
