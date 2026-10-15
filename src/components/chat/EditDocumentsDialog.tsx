"use client";

import { LoaderCircle } from "lucide-react";
import { useState } from "react";
import { useDocumentsContext } from "@/components/documents/DocumentsProvider";
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
import type { ConversationDocument } from "@/types";
import { DocumentPicker } from "./DocumentPicker";

/**
 * Changes which documents a chat can see, mid-conversation. Earlier answers
 * stay as they are; from the next message on, Claude searches the new set.
 */
export function EditDocumentsDialog({
  open,
  onOpenChange,
  current,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  current: ConversationDocument[];
  /** Rejects with a user-facing message if saving failed */
  onSave: (documentIds: string[]) => Promise<void>;
}) {
  const { documents } = useDocumentsContext();
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(current.map((d) => d.id)));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Each opening starts from what the chat has now, not from an abandoned edit
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setSelected(new Set(current.map((d) => d.id)));
      setError(null);
    }
  }

  const unchanged = selected.size === current.length && current.every((document) => selected.has(document.id));

  function handleOpenChange(next: boolean) {
    if (!pending) onOpenChange(next);
  }

  function toggle(documentId: string, checked: boolean) {
    setSelected((existing) => {
      const next = new Set(existing);
      if (checked) next.add(documentId);
      else next.delete(documentId);
      return next;
    });
  }

  async function handleSave() {
    setPending(true);
    setError(null);
    try {
      // Keep the chat's existing order, new picks after
      const kept = current.map((d) => d.id).filter((id) => selected.has(id));
      const added = [...selected].filter((id) => !kept.includes(id));
      await onSave([...kept, ...added]);
      onOpenChange(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Couldn't save the changes.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Documents in this chat</DialogTitle>
          <DialogDescription>
            Claude answers from these documents. Changes apply from your next message.
          </DialogDescription>
        </DialogHeader>
        <DocumentPicker
          documents={documents}
          selected={selected}
          onToggle={toggle}
          disabled={pending}
          legend="Choose the documents to chat with"
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={pending} />}>Cancel</DialogClose>
          <Button onClick={handleSave} disabled={pending || selected.size === 0 || unchanged}>
            {pending && <LoaderCircle className="animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
