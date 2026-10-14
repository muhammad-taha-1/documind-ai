"use client";

import { LoaderCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { deleteDocument } from "@/lib/documents/client";
import type { DocumentDetail } from "@/types";
import { useDocumentsContext } from "./DocumentsProvider";

/** Confirms, then deletes a document everywhere: its passages, its file, and its place in chats. */
export function DeleteDocumentDialog({
  document,
  open,
  onOpenChange,
  onDeleted,
}: {
  document: DocumentDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const { removeDocument } = useDocumentsContext();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setPending(true);
    setError(null);
    try {
      await deleteDocument(document.id);
      removeDocument(document.id);
      onDeleted();
      // Stay pending: the page is about to change
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Couldn't delete the document.");
      setPending(false);
    }
  }

  const passages =
    document.totalChunks > 0 &&
    ` and its ${document.totalChunks} ${document.totalChunks === 1 ? "passage" : "passages"}`;
  const chats = document.chatCount === 1 ? "1 chat" : `${document.chatCount} chats`;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && pending) return;
        if (!next) setError(null);
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this document?</DialogTitle>
          <DialogDescription>
            “{document.title}”{passages} will be permanently deleted.
            {document.chatCount > 0 &&
              ` It will be removed from ${chats}. The chats stay, but their replies will no longer show sources from this document.`}
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={pending} />}>Cancel</DialogClose>
          <Button variant="destructive" onClick={handleDelete} disabled={pending}>
            {pending && <LoaderCircle className="animate-spin" />}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
