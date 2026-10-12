import { ChevronRight } from "lucide-react";
import type { ChatSource } from "@/types";

/**
 * One passage a reply was based on: where it's from and how closely it
 * matched, with a preview that expands to the full passage.
 */
export function SourceCard({ source }: { source: ChatSource }) {
  return (
    <details className="group rounded-md border bg-muted/30 text-xs">
      <summary className="flex cursor-pointer list-none items-start gap-2 p-2.5 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        <div className="grid min-w-0 flex-1 gap-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-medium">Source {source.position}</span>
            <span className="min-w-0 truncate text-muted-foreground" title={source.documentTitle}>
              {source.documentTitle}
              {source.pageNumber !== null && `, page ${source.pageNumber}`}
            </span>
            {source.similarity !== null && (
              <span
                className="ml-auto shrink-0 text-muted-foreground tabular-nums"
                title="Cosine similarity between your question and this passage (1 = identical meaning)"
              >
                similarity {source.similarity.toFixed(2)}
              </span>
            )}
          </div>
          <p className="line-clamp-2 text-muted-foreground group-open:hidden">{source.content}</p>
        </div>
      </summary>
      <p className="border-t px-3 py-2.5 leading-relaxed whitespace-pre-wrap text-muted-foreground">
        {source.content}
      </p>
    </details>
  );
}
