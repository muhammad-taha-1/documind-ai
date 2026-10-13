"use client";

import { LoaderCircle, Pencil } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useRef, useState } from "react";
import { MAX_TITLE_LENGTH } from "@/lib/chat/validation";

/**
 * The chat's title as a heading; click it to rename. Enter or clicking away
 * saves, Escape cancels. A failed save keeps the box open with the error.
 */
export function ConversationTitle({
  title,
  onRename,
}: {
  title: string;
  /** Rejects with a user-facing message if the rename failed */
  onRename: (title: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Escape unmounts the input, which can fire blur; that blur mustn't save
  const cancelled = useRef(false);

  function startEditing() {
    cancelled.current = false;
    setDraft(title);
    setError(null);
    setEditing(true);
  }

  async function save() {
    if (cancelled.current || pending) return;
    const next = draft.replace(/\s+/g, " ").trim();
    if (!next || next === title) {
      setEditing(false);
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onRename(next);
      setEditing(false);
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : "Couldn't rename the chat.");
    } finally {
      setPending(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void save();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      cancelled.current = true;
      setEditing(false);
    }
  }

  if (!editing) {
    return (
      <h1 className="min-w-0">
        <button
          type="button"
          onClick={startEditing}
          className="group/title flex max-w-full items-center gap-2 rounded-md px-1.5 py-1 text-left font-medium outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`${title} (rename)`}
        >
          <span className="truncate">{title}</span>
          <Pencil className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/title:opacity-100 group-focus-visible/title:opacity-100" />
        </button>
      </h1>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex min-w-0 flex-1 items-center gap-2">
      <label htmlFor="conversation-title" className="sr-only">
        Chat title
      </label>
      <input
        id="conversation-title"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => void save()}
        maxLength={MAX_TITLE_LENGTH}
        disabled={pending}
        aria-invalid={error !== null || undefined}
        aria-describedby={error ? "conversation-title-error" : undefined}
        // Opened by the user's own click, so moving focus here is expected
        autoFocus
        onFocus={(event) => event.target.select()}
        className="h-8 w-full max-w-md min-w-0 rounded-md border border-input bg-transparent px-2 font-medium outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
      />
      {pending && <LoaderCircle className="size-4 shrink-0 animate-spin text-muted-foreground" />}
      {error && (
        <p id="conversation-title-error" role="alert" className="truncate text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
