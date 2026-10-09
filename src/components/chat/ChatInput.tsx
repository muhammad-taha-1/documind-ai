"use client";

import { ArrowUp } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Message box that grows with its content (up to ~4 lines, then scrolls).
 * Enter sends; Shift+Enter starts a new line.
 */
export function ChatInput({
  onSend,
  disabled = false,
  placeholder = "Ask a question about your documents…",
}: {
  onSend: (message: string) => void;
  /** e.g. while the assistant is replying. The box stays typeable; only sending waits. */
  disabled?: boolean;
  placeholder?: string;
}) {
  const [value, setValue] = useState("");
  const canSend = !disabled && value.trim().length > 0;

  function send() {
    if (!canSend) return;
    onSend(value.trim());
    setValue("");
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    send();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // isComposing: Enter also confirms IME input (e.g. Japanese) — don't send then
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-end gap-2 rounded-2xl border border-input bg-card p-2 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50"
    >
      <label htmlFor="chat-input" className="sr-only">
        Message
      </label>
      <textarea
        id="chat-input"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={1}
        className="field-sizing-content max-h-[calc(4lh+1rem)] min-h-9 flex-1 resize-none bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted-foreground"
      />
      <Button
        type="submit"
        size="icon"
        disabled={!canSend}
        aria-label="Send message"
        className="rounded-xl"
      >
        <ArrowUp />
      </Button>
    </form>
  );
}
