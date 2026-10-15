import { Files, MessageSquareText } from "lucide-react";
import type { DocumentSummary } from "@/types";
import { DocumentCard } from "./DocumentCard";

export function DocumentList({
  documents,
  onRetry,
}: {
  documents: DocumentSummary[];
  onRetry: (documentId: string) => Promise<void>;
}) {
  if (documents.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center">
        <div className="relative mb-1" aria-hidden>
          <div className="flex size-14 items-center justify-center rounded-2xl bg-muted">
            <Files className="size-7 text-muted-foreground" />
          </div>
          <div className="absolute -right-2 -bottom-2 flex size-7 items-center justify-center rounded-full border-4 border-background bg-primary text-primary-foreground">
            <MessageSquareText className="size-3.5" />
          </div>
        </div>
        <p className="font-medium">Upload your first document to get started</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          Add a PDF above. Once it&apos;s processed, ask questions about it and get answers with citations.
        </p>
      </div>
    );
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {documents.map((document) => (
        <li key={document.id}>
          <DocumentCard document={document} onRetry={onRetry} />
        </li>
      ))}
    </ul>
  );
}
