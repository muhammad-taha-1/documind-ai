"use client";

import { FileText } from "lucide-react";
import { DocumentStatusBadge } from "@/components/documents/DocumentStatusBadge";
import { Checkbox } from "@/components/ui/checkbox";
import { MAX_DOCUMENTS_PER_CONVERSATION } from "@/lib/chat/validation";
import { cn } from "@/lib/utils";
import type { DocumentSummary } from "@/types";

/**
 * A checklist of the user's documents for choosing what a chat can see.
 * Only ready documents can be added (the others show why not), but a
 * selected document can always be removed. Stops at the per-chat limit.
 */
export function DocumentPicker({
  documents,
  selected,
  onToggle,
  disabled = false,
  legend,
}: {
  documents: DocumentSummary[];
  selected: ReadonlySet<string>;
  onToggle: (documentId: string, checked: boolean) => void;
  disabled?: boolean;
  legend: string;
}) {
  const atLimit = selected.size >= MAX_DOCUMENTS_PER_CONVERSATION;

  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-sm text-muted-foreground">
        {legend}
        {selected.size > 0 && ` · ${selected.size} selected`}
      </legend>
      {documents.map((document) => {
        const ready = document.status === "READY";
        const checked = selected.has(document.id);
        const unavailable = !checked && (!ready || atLimit);
        return (
          <label
            key={document.id}
            data-disabled={disabled || unavailable || undefined}
            data-checked={checked || undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5 transition-colors",
              "has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
              "data-checked:border-primary/60 data-checked:bg-primary/5",
              disabled || unavailable ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-muted/40",
            )}
          >
            <Checkbox
              checked={checked}
              disabled={disabled || unavailable}
              onCheckedChange={(value) => onToggle(document.id, value)}
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
      {atLimit && (
        <p className="text-xs text-muted-foreground">
          You can chat with up to {MAX_DOCUMENTS_PER_CONVERSATION} documents at once.
        </p>
      )}
    </fieldset>
  );
}
