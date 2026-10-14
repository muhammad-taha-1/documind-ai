import { ChevronRight, ExternalLink, FileSearch } from "lucide-react";
import Link from "next/link";
import { type Relevance, relevanceOf } from "@/lib/ai/relevance";
import { documentFilePath, passagePath } from "@/lib/documents/paths";
import { cn } from "@/lib/utils";
import type { ChatSource } from "@/types";

const RELEVANCE_BADGES: Record<Relevance, { label: string; className: string }> = {
  close: {
    label: "Close match",
    className: "bg-emerald-500/15 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-400",
  },
  loose: {
    label: "Loose match",
    className: "bg-amber-500/15 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400",
  },
};

/**
 * One passage a reply was based on: where it's from and how closely it
 * matched, with a preview that expands to the full passage and links to it
 * in the document. Open state is controlled, so a citation in the reply
 * can open it.
 */
export function SourceCard({
  source,
  id,
  open,
  onOpenChange,
}: {
  source: ChatSource;
  /** The element ID citations use to find this card */
  id: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const relevance = relevanceOf(source.similarity);
  const badge = relevance && RELEVANCE_BADGES[relevance];

  return (
    <details
      id={id}
      open={open}
      onToggle={(event) => onOpenChange(event.currentTarget.open)}
      className="group scroll-my-4 rounded-md border bg-muted/30 text-xs"
    >
      <summary className="flex cursor-pointer list-none items-start gap-2 rounded-md p-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        <div className="grid min-w-0 flex-1 gap-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-medium">Source {source.position}</span>
            <span className="min-w-0 truncate text-muted-foreground" title={source.documentTitle}>
              {source.documentTitle}
              {source.pageNumber !== null && `, page ${source.pageNumber}`}
            </span>
            {badge && source.similarity !== null && (
              <span
                className={cn("ml-auto shrink-0 rounded-full px-1.5 py-px font-medium", badge.className)}
                title={`Similarity ${source.similarity.toFixed(2)}. Scores rank passages but aren't percentages: right answers often score 0.25–0.65.`}
              >
                {badge.label}
              </span>
            )}
          </div>
          <p className="line-clamp-2 text-muted-foreground group-open:hidden">{source.content}</p>
        </div>
      </summary>
      <div className="grid gap-2.5 border-t px-3 py-2.5">
        <p className="leading-relaxed whitespace-pre-wrap text-muted-foreground">{source.content}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <Link
            href={passagePath(source.documentId, source.chunkId)}
            className="inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline"
          >
            <FileSearch className="size-3.5" />
            Open in document
          </Link>
          <a
            href={documentFilePath(source.documentId, source.pageNumber)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline"
          >
            <ExternalLink className="size-3.5" />
            {source.pageNumber === null ? "View PDF" : `View PDF at page ${source.pageNumber}`}
          </a>
        </div>
      </div>
    </details>
  );
}
