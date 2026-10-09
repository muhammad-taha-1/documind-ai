"use client";

import { createContext, type ReactNode, use } from "react";
import { useDocuments } from "@/hooks/useDocuments";
import type { DocumentSummary } from "@/types";

type DocumentsContextValue = ReturnType<typeof useDocuments>;

const DocumentsContext = createContext<DocumentsContextValue | null>(null);

/**
 * One document list for the whole dashboard. The sidebar, the Documents page
 * and the new-chat picker all read it, so an upload or a status change shows
 * up everywhere at once — and there's only ever one poller.
 */
export function DocumentsProvider({
  initialDocuments,
  children,
}: {
  initialDocuments: DocumentSummary[];
  children: ReactNode;
}) {
  const value = useDocuments(initialDocuments);
  return <DocumentsContext value={value}>{children}</DocumentsContext>;
}

export function useDocumentsContext(): DocumentsContextValue {
  const value = use(DocumentsContext);
  if (!value) {
    throw new Error("useDocumentsContext must be used inside <DocumentsProvider>");
  }
  return value;
}
