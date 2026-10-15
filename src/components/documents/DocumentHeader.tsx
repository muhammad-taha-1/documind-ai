"use client";

import { ArrowLeft, ExternalLink, FileText, LoaderCircle, MessageSquarePlus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useConversations } from "@/components/chat/ConversationsProvider";
import { LocalTime } from "@/components/common/LocalTime";
import { Button, buttonVariants } from "@/components/ui/button";
import { createConversation } from "@/lib/chat/client";
import { documentFilePath } from "@/lib/documents/paths";
import { formatBytes } from "@/lib/format";
import type { DocumentDetail } from "@/types";
import { DeleteDocumentDialog } from "./DeleteDocumentDialog";
import { DocumentStatusBadge } from "./DocumentStatusBadge";
import { useDocumentsContext } from "./DocumentsProvider";
import { RetryButton } from "./RetryButton";

/**
 * The top of a document's page: what it is, its status, and what can be done
 * with it. The status comes from the dashboard-wide document list, which is
 * polled while processing runs, so it stays current.
 */
export function DocumentHeader({ document: rendered }: { document: DocumentDetail }) {
  const router = useRouter();
  const { documents, retry } = useDocumentsContext();
  const [deleting, setDeleting] = useState(false);

  const live = documents.find((candidate) => candidate.id === rendered.id);
  const document = live ? { ...rendered, ...live } : rendered;

  // The passages below are rendered on the server: reload them when
  // processing moves on (e.g. finishes, or a retry clears them)
  const lastStatus = useRef(document.status);
  useEffect(() => {
    if (lastStatus.current !== document.status) {
      lastStatus.current = document.status;
      router.refresh();
    }
  }, [document.status, router]);

  const details = [
    document.fileName,
    document.pageCount !== null && `${document.pageCount} ${document.pageCount === 1 ? "page" : "pages"}`,
    formatBytes(document.fileSize),
    document.status === "READY" && `${document.totalChunks} ${document.totalChunks === 1 ? "passage" : "passages"}`,
  ].filter(Boolean);

  return (
    <header className="grid gap-4">
      <Link
        href="/dashboard"
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Documents
      </Link>

      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <FileText className="size-5" />
        </div>
        <div className="grid min-w-0 flex-1 gap-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="min-w-0 text-2xl font-semibold tracking-tight break-words">{document.title}</h1>
            <DocumentStatusBadge document={document} />
          </div>
          <p className="text-sm break-words text-muted-foreground">
            {details.join(" · ")} · Uploaded <LocalTime iso={document.createdAt} variant="date" />
          </p>
        </div>
      </div>

      {document.status === "ERROR" && (
        <div className="grid gap-2">
          {document.errorMessage && <p className="text-sm text-destructive">{document.errorMessage}</p>}
          <RetryButton onRetry={() => retry(document.id)} />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <StartChatButton documentId={document.id} ready={document.status === "READY"} />
        <a
          href={documentFilePath(document.id)}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: "outline" })}
        >
          <ExternalLink />
          View PDF
        </a>
        <Button
          variant="ghost"
          onClick={() => setDeleting(true)}
          className="text-destructive hover:bg-destructive/10 hover:text-destructive sm:ml-auto"
        >
          <Trash2 />
          Delete
        </Button>
      </div>

      <DeleteDocumentDialog
        document={document}
        open={deleting}
        onOpenChange={setDeleting}
        onDeleted={() => router.replace("/dashboard")}
      />
    </header>
  );
}

/** Starts a chat about just this document */
function StartChatButton({ documentId, ready }: { documentId: string; ready: boolean }) {
  const router = useRouter();
  const { upsertConversation } = useConversations();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setPending(true);
    setError(null);
    try {
      const conversation = await createConversation([documentId]);
      upsertConversation(conversation);
      router.push(`/chat/${conversation.id}`);
      // Stay pending: the page is about to change
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Couldn't start the chat.");
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        onClick={handleClick}
        disabled={!ready || pending}
        title={ready ? undefined : "Available once the document has finished processing"}
      >
        {pending ? <LoaderCircle className="animate-spin" /> : <MessageSquarePlus />}
        Chat with this document
      </Button>
      {error && <span className="text-sm text-destructive">{error}</span>}
    </div>
  );
}
