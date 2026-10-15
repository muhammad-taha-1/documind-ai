"use client";

import { CircleAlert, FileText, Hourglass, Pencil, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { type PendingExchange, useChat } from "@/hooks/useChat";
import { useDraftImages } from "@/hooks/useDraftImages";
import { updateConversation } from "@/lib/chat/client";
import type { ChatMessage, ConversationDetail, TokenUsage } from "@/types";
import { ChatInput } from "./ChatInput";
import { ChatWindow } from "./ChatWindow";
import { ConversationTitle } from "./ConversationTitle";
import { useConversations } from "./ConversationsProvider";
import { EditDocumentsDialog } from "./EditDocumentsDialog";
import { ConversationTokenUsage } from "./TokenUsage";
import { documentPath } from "@/lib/documents/paths";

/** A conversation: title, messages, and the input with its documents above it. */
export function ChatView({ conversation }: { conversation: ConversationDetail }) {
  const { conversations, upsertConversation, replaceConversation } = useConversations();
  const { messages, pending, error, dismissError, sendMessage } = useChat({
    conversationId: conversation.id,
    initialMessages: conversation.messages,
    onConversationChange: upsertConversation,
  });
  const [draft, setDraft] = useState("");
  const draftImages = useDraftImages();
  const [documents, setDocuments] = useState(conversation.documents);
  const [editingDocuments, setEditingDocuments] = useState(false);

  // The first exchange names the chat and the user can rename it; the sidebar's copy is the latest
  const title = conversations.find((c) => c.id === conversation.id)?.title ?? conversation.title;

  async function handleSend(content: string) {
    const images = draftImages.take();
    const sent = await sendMessage(content, images);
    if (sent) {
      // The saved message shows the stored copies; the local previews can go
      draftImages.release(images);
    } else {
      // Nothing was saved — give the text and images back, unless they've started typing again
      setDraft((current) => (current.trim() ? current : content));
      draftImages.restore(images);
    }
  }

  async function handleRename(next: string) {
    const updated = await updateConversation(conversation.id, { title: next });
    replaceConversation(updated.conversation);
  }

  async function handleDocumentsSave(documentIds: string[]) {
    const updated = await updateConversation(conversation.id, { documentIds });
    setDocuments(updated.documents);
  }

  // The exchange in flight is shown as if saved; the reply bubble appears
  // with its first text or tool call
  const displayed: ChatMessage[] = pending
    ? [
        ...messages,
        pending.userMessage,
        ...(pending.reply || pending.toolCalls.length > 0
          ? [
              {
                id: "streaming-reply",
                role: "assistant" as const,
                content: pending.reply,
                attachments: [],
                createdAt: pending.userMessage.createdAt,
                // Sources and usage arrive with the saved reply
                retrieval: null,
                sources: [],
                toolCalls: pending.toolCalls,
                usage: null,
              },
            ]
          : []),
      ]
    : messages;

  const usages = messages.flatMap((message): TokenUsage[] => (message.usage ? [message.usage] : []));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-3">
        <div className="flex min-w-0 flex-1">
          <ConversationTitle key={title} title={title} onRename={handleRename} />
        </div>
        <ConversationTokenUsage usages={usages} />
      </header>

      <ChatWindow
        messages={displayed}
        compaction={conversation.compaction}
        isLoading={pending !== null && !pending.reply}
        isStreaming={pending !== null}
        emptyState={
          <div className="grid gap-1">
            <p className="font-medium">Ask anything about your documents</p>
            <p className="text-sm text-muted-foreground">
              Answers come from the documents below. You can also attach screenshots, charts or photos.
            </p>
          </div>
        }
      />

      <div className="mx-auto grid w-full max-w-3xl gap-2 px-4 pb-4">
        {pending?.retry && <RetryNotice retry={pending.retry} />}
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
        <div className="flex items-start gap-2">
          <ul aria-label="Documents in this chat" className="flex min-w-0 flex-1 flex-wrap gap-1.5">
            {documents.map((document) => (
              <li key={document.id} className="max-w-60">
                <Link
                  href={documentPath(document.id)}
                  title={document.title}
                  className="flex items-center gap-1.5 rounded-md border bg-muted/50 px-2 py-1 text-xs text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <FileText className="size-3.5 shrink-0" />
                  <span className="truncate">{document.title}</span>
                </Link>
              </li>
            ))}
            {documents.length === 0 && (
              <li className="py-1 text-xs text-muted-foreground">
                The documents in this chat have been deleted. Add some to keep chatting.
              </li>
            )}
          </ul>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setEditingDocuments(true)}
            className="shrink-0 text-muted-foreground"
          >
            <Pencil />
            Documents
          </Button>
        </div>
        <ChatInput
          value={draft}
          onValueChange={setDraft}
          images={draftImages.images}
          onAddImages={draftImages.add}
          onRemoveImage={draftImages.remove}
          imageError={draftImages.error}
          onSend={handleSend}
          disabled={pending !== null}
        />
      </div>

      <EditDocumentsDialog
        open={editingDocuments}
        onOpenChange={setEditingDocuments}
        current={documents}
        onSave={handleDocumentsSave}
      />
    </div>
  );
}

const RETRY_MESSAGES = {
  rate_limited: "Claude is handling a lot of requests right now.",
  unavailable: "Claude is temporarily unavailable.",
} as const;

/** "Please wait" while the server retries, counting down to the next attempt */
function RetryNotice({ retry }: { retry: NonNullable<PendingExchange["retry"]> }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);

  const seconds = Math.ceil((retry.retryAt - now) / 1000);
  return (
    <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
      <Hourglass className="size-3.5 shrink-0" />
      <span>
        {RETRY_MESSAGES[retry.reason]} {/* The ticking countdown is for the eye; screen readers hear it once */}
        <span aria-hidden>{seconds > 0 ? `Trying again in ${seconds}s…` : "Trying again…"}</span>
        <span className="sr-only">Trying again shortly.</span>
      </span>
    </p>
  );
}
