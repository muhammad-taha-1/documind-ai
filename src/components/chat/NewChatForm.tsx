"use client";

import { CircleAlert, FileText, Files, LoaderCircle, MessageSquarePlus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DocumentStatusBadge } from "@/components/documents/DocumentStatusBadge";
import { useDocumentsContext } from "@/components/documents/DocumentsProvider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { createConversation } from "@/lib/chat/client";
import { MAX_DOCUMENTS_PER_CONVERSATION } from "@/lib/chat/validation";
import { cn } from "@/lib/utils";
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
  const atLimit = selectedIds.length >= MAX_DOCUMENTS_PER_CONVERSATION;

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
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm text-muted-foreground">
          Choose the documents to chat with
          {selectedIds.length > 0 && ` · ${selectedIds.length} selected`}
        </legend>
        {documents.map((document) => {
          const ready = document.status === "READY";
          const checked = selectedIds.includes(document.id);
          const disabled = !ready || pending || (atLimit && !checked);
          return (
            <label
              key={document.id}
              data-disabled={disabled || undefined}
              data-checked={checked || undefined}
              className={cn(
                "flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5 transition-colors",
                "has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
                "data-checked:border-primary/60 data-checked:bg-primary/5",
                disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-muted/40",
              )}
            >
              <Checkbox
                checked={checked}
                disabled={disabled}
                onCheckedChange={(value) => toggle(document.id, value)}
              />
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-sm" title={document.title}>
                {document.title}
              </span>
              {/* Explains why a document can't be picked yet */}
              {!ready && <DocumentStatusBadge document={document} />}
            </label>
          );
        })}
      </fieldset>

      {atLimit && (
        <p className="text-xs text-muted-foreground">
          You can chat with up to {MAX_DOCUMENTS_PER_CONVERSATION} documents at once.
        </p>
      )}
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
