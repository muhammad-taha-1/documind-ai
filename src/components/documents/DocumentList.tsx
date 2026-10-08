import { Files } from "lucide-react";
import type { DocumentSummary } from "@/types";
import { DocumentCard } from "./DocumentCard";

export function DocumentList({ documents }: { documents: DocumentSummary[] }) {
  if (documents.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center">
        <Files className="size-8 text-muted-foreground" />
        <p className="font-medium">No documents yet</p>
        <p className="text-sm text-muted-foreground">
          Upload a PDF above to start chatting with it.
        </p>
      </div>
    );
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {documents.map((document) => (
        <li key={document.id}>
          <DocumentCard document={document} />
        </li>
      ))}
    </ul>
  );
}
