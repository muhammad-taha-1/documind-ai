import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { LocalTime } from "@/components/common/LocalTime";
import type { ChatMessage } from "@/types";

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
 * Assistant messages: left-aligned, no background, rendered as markdown.
 */
export function MessageBubble({ message }: { message: Pick<ChatMessage, "role" | "content" | "createdAt"> }) {
  const isUser = message.role === "user";

  return (
    <div className={`group/message flex flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}>
      {isUser ? (
        <div className="max-w-[85%] rounded-2xl bg-muted px-4 py-2.5 text-sm whitespace-pre-wrap break-words">
          {message.content}
        </div>
      ) : (
        <div className="prose prose-sm prose-neutral dark:prose-invert max-w-none break-words prose-pre:overflow-x-auto">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {message.content}
          </ReactMarkdown>
        </div>
      )}
      <LocalTime
        iso={message.createdAt}
        variant="full"
        className="px-1 text-xs text-muted-foreground opacity-0 transition-opacity group-hover/message:opacity-100"
      />
    </div>
  );
}
