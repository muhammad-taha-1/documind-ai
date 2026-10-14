import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { DocumentHeader } from "@/components/documents/DocumentHeader";
import { DocumentPassages } from "@/components/documents/DocumentPassages";
import { getSession } from "@/lib/auth";
import { getDocumentDetail, listDocumentPassages } from "@/lib/documents/queries";

export const metadata: Metadata = {
  title: "Document · DocuMind AI",
};

const MAX_QUERY_LENGTH = 200;

/** One value of a search param: the first if it's repeated */
function param(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * A document's page: its details and actions, then its passages.
 * `?q=` searches the passages, `?page=` pages through them, and `?chunk=`
 * opens the page holding one passage and highlights it (citations link here).
 */
export default async function DocumentPage({ params, searchParams }: PageProps<"/documents/[id]">) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  const { id } = await params;
  const search = await searchParams;

  const document = await getDocumentDetail(session.user.id, id);
  if (!document) {
    // Also shown for other users' documents
    notFound();
  }

  const query = (param(search.q) ?? "").trim().slice(0, MAX_QUERY_LENGTH);
  const page = Number(param(search.page));
  const chunkId = param(search.chunk);
  const result = await listDocumentPassages(session.user.id, id, {
    page: Number.isFinite(page) ? page : 1,
    query: query || undefined,
    chunkId,
  });

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-6 py-10">
        <DocumentHeader document={document} />
        <DocumentPassages
          documentId={id}
          result={result}
          query={query}
          focusedChunkId={query ? null : (chunkId ?? null)}
        />
      </div>
    </div>
  );
}
