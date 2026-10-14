import { ChevronRight, Info } from "lucide-react";
import type { ChatMessage, RetrievalMode } from "@/types";
import { SourceCard } from "./SourceCard";

/** Shown when the documents gave the reply little or nothing to go on */
const RELEVANCE_NOTICES: Partial<Record<RetrievalMode, string>> = {
  WEAK_MATCH:
    "These passages only loosely match your question, so parts of this answer may not come from your documents.",
  NO_MATCH: "Nothing in your documents closely matched this question.",
  NO_DOCUMENTS: "This chat's documents have no searchable text, so this answer doesn't use them.",
};

/** The element ID of a reply's source card, which its citations scroll to */
export function sourceCardId(idPrefix: string, position: number): string {
  return `${idPrefix}-source-${position}`;
}

/**
 * Under an assistant reply: how well the documents matched, and the passages
 * Claude was given (collapsed to a count until opened). What's open is
 * controlled by the reply, so its citations can open a source.
 */
export function MessageSources({
  retrieval,
  sources,
  idPrefix,
  open,
  onOpenChange,
  openCards,
  onCardOpenChange,
}: Pick<ChatMessage, "retrieval" | "sources"> & {
  idPrefix: string;
  /** Whether the list of sources is expanded */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Positions of the source cards that are expanded */
  openCards: ReadonlySet<number>;
  onCardOpenChange: (position: number, open: boolean) => void;
}) {
  if (retrieval === null) {
    return null; // A user message, or a reply from before document search existed
  }
  const notice = RELEVANCE_NOTICES[retrieval];

  return (
    <div className="grid w-full gap-2">
      {notice && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-px size-3.5 shrink-0" />
          {notice}
        </p>
      )}
      {sources.length > 0 && (
        <details
          className="group/sources"
          open={open}
          onToggle={(event) => onOpenChange(event.currentTarget.open)}
        >
          <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-3.5 transition-transform group-open/sources:rotate-90" />
            {sources.length} {sources.length === 1 ? "source" : "sources"}
            {retrieval === "FULL_TEXT" && <span className="font-normal">· full text of your documents</span>}
          </summary>
          <ol className="mt-2 grid gap-1.5">
            {sources.map((source) => (
              <li key={source.position}>
                <SourceCard
                  source={source}
                  id={sourceCardId(idPrefix, source.position)}
                  open={openCards.has(source.position)}
                  onOpenChange={(cardOpen) => onCardOpenChange(source.position, cardOpen)}
                />
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
