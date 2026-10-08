"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { retryProcessing } from "@/lib/documents/client";
import type { DocumentStatus, DocumentSummary } from "@/types";

const POLL_INTERVAL_MS = 2000;
const IN_PROGRESS: ReadonlySet<DocumentStatus> = new Set(["UPLOADING", "PROCESSING", "EMBEDDING"]);

/**
 * Client-side document list state. The dashboard renders the initial list on
 * the server (no loading spinner); this hook takes over from there.
 *
 * Processing runs in the background on the server, so while any document is
 * still in progress the hook polls GET /api/documents and stops once all are
 * READY or ERROR.
 */
export function useDocuments(initialDocuments: DocumentSummary[]) {
  const [documents, setDocuments] = useState(initialDocuments);
  // Bumped on every local change. A poll that started before a local change
  // may not include it (e.g. a just-finished upload), so its result is dropped
  // and the next poll catches up.
  const localVersion = useRef(0);

  const hasInProgress = documents.some((document) => IN_PROGRESS.has(document.status));

  useEffect(() => {
    if (!hasInProgress) {
      return;
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      const versionAtStart = localVersion.current;
      try {
        const response = await fetch("/api/documents", { signal: controller.signal });
        if (response.ok && localVersion.current === versionAtStart) {
          const body = (await response.json()) as { documents: DocumentSummary[] };
          setDocuments(body.documents);
        }
      } catch {
        // Aborted on unmount, or a network blip — the next tick tries again
      }
      if (!controller.signal.aborted) {
        timer = setTimeout(poll, POLL_INTERVAL_MS);
      }
    }

    // setTimeout chaining (not setInterval) so a slow response never overlaps the next poll
    timer = setTimeout(poll, POLL_INTERVAL_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [hasInProgress]);

  const addDocument = useCallback((document: DocumentSummary) => {
    localVersion.current++;
    setDocuments((current) => [document, ...current]);
  }, []);

  /** Restarts processing for a failed document. Rejects with a displayable Error. */
  const retry = useCallback(async (documentId: string) => {
    await retryProcessing(documentId);
    localVersion.current++;
    setDocuments((current) =>
      current.map((document) =>
        document.id === documentId
          ? { ...document, status: "PROCESSING", errorMessage: null }
          : document,
      ),
    );
  }, []);

  return { documents, addDocument, retry };
}
