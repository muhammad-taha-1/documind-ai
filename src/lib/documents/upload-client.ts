import type { ApiError } from "@/lib/api";
import type { DocumentSummary } from "@/types";

const GENERIC_ERROR = "Upload failed. Please try again.";

function errorMessageFrom(responseText: string): string {
  try {
    const body = JSON.parse(responseText) as Partial<ApiError>;
    return typeof body.error === "string" ? body.error : GENERIC_ERROR;
  } catch {
    return GENERIC_ERROR;
  }
}

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
        reject(new Error(errorMessageFrom(xhr.responseText)));
      }
    };
    xhr.onerror = () => reject(new Error("Network error — check your connection and try again."));

    const formData = new FormData();
    formData.append("file", file);
    xhr.send(formData);
  });
}
