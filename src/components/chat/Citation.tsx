"use client";

import { createContext, use } from "react";
import type { ExtraProps } from "react-markdown";
import { readSourceNumbers } from "@/lib/chat/citations";
import type { ChatSource } from "@/types";

interface CitationsContextValue {
  /**
   * The reply's sources by number. Null while there's nothing to link to
   * yet: the reply is still streaming (sources arrive with the saved reply).
   */
  sources: ReadonlyMap<number, ChatSource> | null;
  /** Opens the source's card under the reply and brings it into view */
  reveal: (position: number) => void;
}

/** Provided by each reply, so its citations link to its own sources */
export const CitationsContext = createContext<CitationsContextValue | null>(null);

const MARKER = "inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 align-[0.15em] text-[0.65rem] leading-none font-semibold tabular-nums no-underline";

/**
 * A citation in a reply, "[Source 2, 3]", shown as one small marker per
 * source. Each opens its source under the reply. Renders the <cite>
 * elements that remarkCitations produces.
 */
export function Citation({ node }: ExtraProps) {
  const context = use(CitationsContext);
  const numbers = readSourceNumbers(node?.properties.dataSources);

  return (
    <span className="mx-0.5 inline-flex gap-0.5">
      {numbers.map((number) => {
        if (!context?.sources) {
          return (
            <span key={number} className={`${MARKER} bg-muted text-muted-foreground`} title={`Source ${number}`}>
              {number}
            </span>
          );
        }
        const source = context.sources.get(number);
        if (!source) {
          // Its chunk is gone: the document was deleted or reprocessed
          const label = `Source ${number} is no longer available: its document was deleted or reprocessed`;
          return (
            <span
              key={number}
              role="img"
              aria-label={label}
              title={label}
              className={`${MARKER} border border-dashed text-muted-foreground line-through`}
            >
              {number}
            </span>
          );
        }
        const label = `Source ${number}: ${source.documentTitle}${
          source.pageNumber === null ? "" : `, page ${source.pageNumber}`
        }`;
        return (
          <button
            key={number}
            type="button"
            onClick={() => context.reveal(number)}
            aria-label={label}
            title={label}
            className={`${MARKER} cursor-pointer bg-sky-500/15 text-sky-700 transition-colors outline-none hover:bg-sky-500/30 focus-visible:ring-2 focus-visible:ring-ring dark:bg-sky-400/15 dark:text-sky-300 dark:hover:bg-sky-400/30`}
          >
            {number}
          </button>
        );
      })}
    </span>
  );
}
