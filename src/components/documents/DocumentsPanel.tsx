"use client";

import { DocumentList } from "./DocumentList";
import { useDocumentsContext } from "./DocumentsProvider";
import { DocumentUpload } from "./DocumentUpload";

/** Upload zone + document list, backed by the dashboard-wide document state. */
export function DocumentsPanel() {
  const { documents, addDocument, retry } = useDocumentsContext();

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
