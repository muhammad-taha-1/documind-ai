import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { LocalTime } from "@/components/common/LocalTime";
import type { ChatMessage } from "@/types";
import { MessageSources } from "./MessageSources";
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
};

/**
 * User messages: right-aligned on a subtle background, shown as typed.
 * Assistant messages: left-aligned, no background: the tools Claude used,
 * then the reply as markdown, then the document passages it was based on.
 */
export function MessageBubble({
  message,
}: {
  message: Pick<ChatMessage, "role" | "content" | "createdAt" | "retrieval" | "sources" | "toolCalls" | "usage">;
}) {
  const isUser = message.role === "user";

  return (
    <div className={`group/message flex flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}>
      {isUser ? (
        <div className="max-w-[85%] rounded-2xl bg-muted px-4 py-2.5 text-sm whitespace-pre-wrap break-words">
          {message.content}
        </div>
      ) : (
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
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {message.content}
            </ReactMarkdown>
          </div>
          <MessageSources retrieval={message.retrieval} sources={message.sources} />
        </>
      )}
      {/* Details on hover, so they don't crowd the conversation */}
      <div className="flex gap-2 px-1 text-xs text-muted-foreground opacity-0 transition-opacity group-hover/message:opacity-100">
        <LocalTime iso={message.createdAt} variant="full" />
        {message.usage && <MessageTokenUsage usage={message.usage} className="tabular-nums" />}
      </div>
    </div>
  );
}
