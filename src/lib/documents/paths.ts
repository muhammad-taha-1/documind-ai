// Links to a document's page and file, built in one place

/** The document's page */
export function documentPath(documentId: string): string {
  return `/documents/${encodeURIComponent(documentId)}`;
}

/** The document's page, opened where one passage is, with that passage highlighted */
export function passagePath(documentId: string, chunkId: string): string {
  const id = encodeURIComponent(chunkId);
  return `${documentPath(documentId)}?chunk=${id}#passage-${id}`;
}

/** The uploaded PDF, opened at `page` when given (the browser's PDF viewer reads #page=) */
export function documentFilePath(documentId: string, page?: number | null): string {
  const path = `/api/documents/${encodeURIComponent(documentId)}/file`;
  return page == null ? path : `${path}#page=${page}`;
}
