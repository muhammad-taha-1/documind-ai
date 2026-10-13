"use client";

import { CircleAlert, Files, LoaderCircle, MessageSquarePlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useDocumentsContext } from "@/components/documents/DocumentsProvider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { createConversation } from "@/lib/chat/client";
import { DocumentPicker } from "./DocumentPicker";
import { useConversations } from "./ConversationsProvider";

/** Pick documents, then start a conversation about them. */
export function NewChatForm() {
  const router = useRouter();
  const { documents } = useDocumentsContext();
  const { upsertConversation } = useConversations();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A document can leave READY (e.g. a retry after an error), so only count
  // selections that are still ready
  const readyIds = new Set(documents.filter((d) => d.status === "READY").map((d) => d.id));
  const selectedIds = [...selected].filter((id) => readyIds.has(id));

  function toggle(documentId: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(documentId);
      else next.delete(documentId);
      return next;
    });
  }

  async function handleStart() {
    setPending(true);
    setError(null);
    try {
      const conversation = await createConversation(selectedIds);
      upsertConversation(conversation);
      router.push(`/chat/${conversation.id}`);
      // Stay pending: the page is about to change
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Couldn't start the chat.");
      setPending(false);
    }
  }

  if (documents.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center">
        <Files className="size-8 text-muted-foreground" />
        <div className="grid gap-1">
          <p className="font-medium">No documents yet</p>
          <p className="text-sm text-muted-foreground">Upload a PDF first, then chat with it here.</p>
        </div>
        <Link href="/dashboard" className={buttonVariants({ variant: "outline" })}>
          Upload a document
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <DocumentPicker
        documents={documents}
        selected={new Set(selectedIds)}
        onToggle={toggle}
        disabled={pending}
        legend="Choose the documents to chat with"
      />

      {error && (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div>
        <Button size="lg" onClick={handleStart} disabled={selectedIds.length === 0 || pending}>
          {pending ? <LoaderCircle className="animate-spin" /> : <MessageSquarePlus />}
          Start chat
        </Button>
      </div>
    </div>
  );
}
