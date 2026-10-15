"use client";

import { useEffect, useId, useMemo, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { LocalTime } from "@/components/common/LocalTime";
import { remarkCitations } from "@/lib/chat/citations";
import type { ChatMessage } from "@/types";
import { Citation, CitationsContext } from "./Citation";
import { MessageImages } from "./MessageImages";
import { MessageSources, sourceCardId } from "./MessageSources";
import { MessageTokenUsage } from "./TokenUsage";
import { ToolCallDisplay } from "./ToolCallDisplay";

// react-markdown never renders raw HTML from the text and strips unsafe URLs
// (javascript: and friends), so model output can't inject markup or scripts
const markdownComponents: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  // remarkCitations turns "[Source 2, 3]" into <cite data-sources="2 3">
  cite: Citation,
};

const remarkPlugins = [remarkGfm, remarkCitations];

type DisplayedMessage = Pick<
  ChatMessage,
  "role" | "content" | "attachments" | "createdAt" | "retrieval" | "sources" | "toolCalls" | "usage"
>;

/**
 * User messages: right-aligned, their images first, then the text on a
 * subtle background, shown as typed.
 * Assistant messages: left-aligned, no background: the tools Claude used,
 * then the reply as markdown, then the document passages it was based on.
 */
export function MessageBubble({ message }: { message: DisplayedMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={`group/message flex flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}>
      {isUser ? (
        <>
          {message.attachments.length > 0 && <MessageImages attachments={message.attachments} />}
          {/* Images can be sent without text */}
          {message.content && (
            <div className="max-w-[85%] rounded-2xl bg-muted px-4 py-2.5 text-sm whitespace-pre-wrap break-words">
              {message.content}
            </div>
          )}
        </>
      ) : (
        <AssistantReply message={message} />
      )}
      {/* Details on hover, so they don't crowd the conversation */}
      <div className="flex gap-2 px-1 text-xs text-muted-foreground opacity-0 transition-opacity group-hover/message:opacity-100">
        <LocalTime iso={message.createdAt} variant="full" />
        {message.usage && <MessageTokenUsage usage={message.usage} className="tabular-nums" />}
      </div>
    </div>
  );
}

/** A reply whose citations open the matching source underneath it */
function AssistantReply({ message }: { message: DisplayedMessage }) {
  const idPrefix = useId();
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [openCards, setOpenCards] = useState<ReadonlySet<number>>(new Set());
  // `count` makes a second click on the same citation reveal it again
  const [revealed, setRevealed] = useState<{ position: number; count: number } | null>(null);

  const sources = useMemo(
    () =>
      // No retrieval: still streaming, or a reply from before sources were kept
      message.retrieval === null ? null : new Map(message.sources.map((source) => [source.position, source])),
    [message.retrieval, message.sources],
  );

  function setCardOpen(position: number, open: boolean) {
    setOpenCards((current) => {
      if (current.has(position) === open) return current;
      const next = new Set(current);
      if (open) next.add(position);
      else next.delete(position);
      return next;
    });
  }

  const citations = useMemo(
    () => ({
      sources,
      reveal(position: number) {
        setSourcesOpen(true);
        setCardOpen(position, true);
        setRevealed((current) => ({ position, count: (current?.count ?? 0) + 1 }));
      },
    }),
    [sources],
  );

  // Once the card is open (after the render above), bring it into view
  useEffect(() => {
    if (!revealed) return;
    const card = document.getElementById(sourceCardId(idPrefix, revealed.position));
    if (!card) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    card.scrollIntoView({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
    // Keyboard and screen reader users land on the source they asked for
    card.querySelector("summary")?.focus({ preventScroll: true });
    // Restart the highlight, even if it's still running from a previous click
    card.classList.remove("source-flash");
    void card.offsetWidth;
    card.classList.add("source-flash");
    card.addEventListener("animationend", () => card.classList.remove("source-flash"), { once: true });
  }, [revealed, idPrefix]);

  return (
    <>
      {message.toolCalls.length > 0 && (
        <ol aria-label="Tools used" className="grid w-full gap-1.5">
          {message.toolCalls.map((call) => (
            <li key={call.id}>
              <ToolCallDisplay call={call} />
            </li>
          ))}
        </ol>
      )}
      <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none break-words prose-pre:overflow-x-auto">
        <CitationsContext value={citations}>
          <ReactMarkdown remarkPlugins={remarkPlugins} components={markdownComponents}>
            {message.content}
          </ReactMarkdown>
        </CitationsContext>
      </div>
      <MessageSources
        retrieval={message.retrieval}
        sources={message.sources}
        idPrefix={idPrefix}
        open={sourcesOpen}
        onOpenChange={setSourcesOpen}
        openCards={openCards}
        onCardOpenChange={setCardOpen}
      />
    </>
  );
}
