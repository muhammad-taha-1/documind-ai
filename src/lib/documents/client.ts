import { parseApiError } from "@/lib/api";
import type { DocumentSummary } from "@/types";

const GENERIC_ERROR = "Upload failed. Please try again.";

/**
 * Uploads a PDF to POST /api/documents and resolves with the created document.
 *
 * Uses XMLHttpRequest rather than fetch because fetch has no upload-progress
 * events in browsers. Rejects with an Error whose message is safe to show.
 */
export function uploadDocument(
  file: File,
  onProgress: (percent: number) => void,
): Promise<DocumentSummary> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/documents");

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status === 201) {
        const body = JSON.parse(xhr.responseText) as { document: DocumentSummary };
        resolve(body.document);
      } else {
        reject(new Error(parseApiError(xhr.responseText, GENERIC_ERROR)));
      }
    };
    xhr.onerror = () => reject(new Error("Network error — check your connection and try again."));

    const formData = new FormData();
    formData.append("file", file);
    xhr.send(formData);
  });
}

/** Asks the server to retry processing a failed document. Rejects with a displayable Error. */
export async function retryProcessing(documentId: string): Promise<void> {
  const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}/process`, {
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(parseApiError(await response.text(), "Couldn't retry. Please try again."));
  }
}
