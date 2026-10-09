"use client";

import { FileText } from "lucide-react";
import { useState } from "react";
import type { ChatMessage, ConversationDetail } from "@/types";
import { ChatInput } from "./ChatInput";
import { ChatWindow } from "./ChatWindow";

/** A conversation: title, messages, and the input with its documents above it. */
export function ChatView({ conversation }: { conversation: ConversationDetail }) {
  const [messages, setMessages] = useState<ChatMessage[]>(conversation.messages);

  function handleSend(content: string) {
    // TODO(Phase 9): send to POST /api/chat and stream the reply in. Until
    // then the message only shows locally (it isn't saved).
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "user", content, createdAt: new Date().toISOString() },
    ]);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center border-b px-4">
        <h1 className="truncate font-medium">{conversation.title}</h1>
      </header>

      <ChatWindow
        messages={messages}
        emptyState={
          <div className="grid gap-1">
            <p className="font-medium">Ask anything about your documents</p>
            <p className="text-sm text-muted-foreground">Answers come from the documents below.</p>
          </div>
        }
      />

      <div className="mx-auto grid w-full max-w-3xl gap-2 px-4 pb-4">
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
        <ChatInput onSend={handleSend} />
      </div>
    </div>
  );
}
