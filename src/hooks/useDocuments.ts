"use client";

import { useCallback, useState } from "react";
import type { DocumentSummary } from "@/types";

/**
 * Client-side document list state. The dashboard renders the initial list on
 * the server (no loading spinner); this hook takes over from there so uploads
 * appear instantly. Later phases add polling here for processing status.
 */
export function useDocuments(initialDocuments: DocumentSummary[]) {
  const [documents, setDocuments] = useState(initialDocuments);

  const addDocument = useCallback((document: DocumentSummary) => {
    setDocuments((current) => [document, ...current]);
  }, []);

  return { documents, addDocument };
}
