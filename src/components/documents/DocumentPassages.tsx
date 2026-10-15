import { ChevronLeft, ChevronRight, Search, SearchX } from "lucide-react";
import Form from "next/form";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PassagePage } from "@/lib/documents/queries";
import { highlightMatches } from "@/lib/documents/highlight";
import { documentPath } from "@/lib/documents/paths";
import { cn } from "@/lib/utils";

/**
 * A document's text as the passages Claude reads, searchable and paged.
 * Everything lives in the URL (?q=, ?page=, ?chunk=), so results can be
 * linked to, and the page works before any JavaScript loads.
 */
export function DocumentPassages({
  documentId,
  result,
  query,
  focusedChunkId,
}: {
  documentId: string;
  result: PassagePage;
  query: string;
  /** The passage a citation linked to, highlighted */
  focusedChunkId: string | null;
}) {
  const basePath = documentPath(documentId);
  const pageHref = (page: number) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (page > 1) params.set("page", String(page));
    const search = params.toString();
    return search ? `${basePath}?${search}` : basePath;
  };

  return (
    <section aria-labelledby="passages-heading" className="grid gap-4">
      <div className="grid gap-1">
        <h2 id="passages-heading" className="font-medium">
          Passages
        </h2>
        <p className="text-sm text-muted-foreground">
          The document is split into these passages. Claude searches them to answer your questions, and each source in a
          chat is one of them.
        </p>
      </div>

      {/* key: show the current query after back/forward navigation */}
      <Form key={query} action={basePath} replace className="flex gap-2" role="search">
        <label htmlFor="document-search" className="sr-only">
          Search this document
        </label>
        <Input
          id="document-search"
          name="q"
          type="search"
          defaultValue={query}
          placeholder="Search this document…"
          maxLength={200}
        />
        <button type="submit" className={buttonVariants({ variant: "outline" })}>
          <Search />
          Search
        </button>
      </Form>

      {query && (
        <p role="status" className="text-sm text-muted-foreground">
          {result.total === 0
            ? `No passages contain “${query}”.`
            : `${result.total} ${result.total === 1 ? "passage contains" : "passages contain"} “${query}”.`}{" "}
          <Link href={basePath} className="underline underline-offset-2 hover:text-foreground">
            Clear search
          </Link>
        </p>
      )}

      {result.passages.length === 0 && !query ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center">
          <SearchX className="size-6 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No passages yet. They appear once the document has been processed.
          </p>
        </div>
      ) : (
        <ol className="grid gap-3">
          {result.passages.map((passage) => (
            <li
              key={passage.id}
              id={`passage-${passage.id}`}
              aria-current={passage.id === focusedChunkId ? "true" : undefined}
              className="scroll-mt-6 rounded-lg border bg-card p-4 aria-[current]:border-sky-500 aria-[current]:ring-2 aria-[current]:ring-sky-500/30"
            >
              <p className="mb-2 flex flex-wrap gap-x-2 text-xs font-medium text-muted-foreground">
                <span>Passage {passage.chunkIndex + 1}</span>
                {passage.pageNumber !== null && <span>· Page {passage.pageNumber}</span>}
                {passage.id === focusedChunkId && (
                  <span className="text-sky-700 dark:text-sky-300">· Cited in your chat</span>
                )}
              </p>
              <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                {highlightMatches(passage.content, query).map((part, i) =>
                  part.match ? (
                    <mark key={i} className="rounded-sm bg-amber-300/50 text-inherit dark:bg-amber-400/30">
                      {part.text}
                    </mark>
                  ) : (
                    part.text
                  ),
                )}
              </p>
            </li>
          ))}
        </ol>
      )}

      {result.pageCount > 1 && (
        <nav aria-label="Passage pages" className="flex items-center justify-between gap-2">
          <PageLink href={pageHref(result.page - 1)} disabled={result.page === 1}>
            <ChevronLeft />
            Previous
          </PageLink>
          <span className="text-sm text-muted-foreground tabular-nums">
            Page {result.page} of {result.pageCount}
          </span>
          <PageLink href={pageHref(result.page + 1)} disabled={result.page === result.pageCount}>
            Next
            <ChevronRight />
          </PageLink>
        </nav>
      )}
    </section>
  );
}

function PageLink({ href, disabled, children }: { href: string; disabled: boolean; children: React.ReactNode }) {
  const className = cn(buttonVariants({ variant: "outline", size: "sm" }));
  if (disabled) {
    return (
      <span aria-disabled="true" className={cn(className, "pointer-events-none opacity-50")}>
        {children}
      </span>
    );
  }
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
