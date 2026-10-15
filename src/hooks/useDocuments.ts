"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/components/ui/toast";
import { retryProcessing } from "@/lib/documents/client";
import type { DocumentStatus, DocumentSummary } from "@/types";

const POLL_INTERVAL_MS = 2000;
const IN_PROGRESS: ReadonlySet<DocumentStatus> = new Set(["UPLOADING", "PROCESSING", "EMBEDDING"]);

/** Failed polls in a row before telling the user the status may be stale (one blip isn't worth it) */
const FAILED_POLLS_BEFORE_WARNING = 3;

/**
 * Tells the user when a document they're waiting on finishes. Processing
 * takes a while and they may be anywhere in the app by then, so a toast
 * rather than only the badge on its card.
 */
function announceFinished(previous: readonly DocumentSummary[], next: readonly DocumentSummary[]) {
  const before = new Map(previous.map((document) => [document.id, document.status]));
  for (const document of next) {
    const was = before.get(document.id);
    if (was === undefined || !IN_PROGRESS.has(was)) continue;
    if (document.status === "READY") {
      toast.add({ type: "success", title: `"${document.title}" is ready`, description: "You can chat with it now." });
    } else if (document.status === "ERROR") {
      toast.add({
        type: "error",
        title: `Couldn't process "${document.title}"`,
        description: document.errorMessage ?? undefined,
      });
    }
  }
}

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

  // What the last render showed, for comparing a poll's result against
  const shown = useRef(documents);
  useEffect(() => {
    shown.current = documents;
  }, [documents]);

  const hasInProgress = documents.some((document) => IN_PROGRESS.has(document.status));

  useEffect(() => {
    if (!hasInProgress) {
      return;
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let failedPolls = 0;

    async function poll() {
      const versionAtStart = localVersion.current;
      try {
        const response = await fetch("/api/documents", { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`GET /api/documents answered ${response.status}`);
        }
        const body = (await response.json()) as { documents: DocumentSummary[] };
        failedPolls = 0;
        if (localVersion.current === versionAtStart) {
          announceFinished(shown.current, body.documents);
          setDocuments(body.documents);
        }
      } catch {
        // A network blip or a server hiccup: the next tick tries again. Say
        // so once if it keeps failing, so a stuck badge isn't a mystery.
        if (!controller.signal.aborted && ++failedPolls === FAILED_POLLS_BEFORE_WARNING) {
          toast.add({
            type: "warning",
            title: "Can't reach the server",
            description: "Document status will update once the connection is back.",
          });
        }
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
        document.id === documentId ? { ...document, status: "PROCESSING", errorMessage: null } : document,
      ),
    );
  }, []);

  /** Drops a document that has been deleted */
  const removeDocument = useCallback((documentId: string) => {
    localVersion.current++;
    setDocuments((current) => current.filter((document) => document.id !== documentId));
  }, []);

  return { documents, addDocument, retry, removeDocument };
}
