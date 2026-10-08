"use client";

import { useDocuments } from "@/hooks/useDocuments";
import type { DocumentSummary } from "@/types";
import { DocumentList } from "./DocumentList";
import { DocumentUpload } from "./DocumentUpload";

/** Upload zone + document list, sharing one piece of client state. */
export function DocumentsPanel({ initialDocuments }: { initialDocuments: DocumentSummary[] }) {
  const { documents, addDocument, retry } = useDocuments(initialDocuments);

  return (
    <div className="grid gap-8">
      <DocumentUpload onUploaded={addDocument} />
      <section className="grid gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          Your documents{documents.length > 0 && ` (${documents.length})`}
        </h2>
        <DocumentList documents={documents} onRetry={retry} />
      </section>
    </div>
  );
}
