"use client";

import { Ellipsis, LoaderCircle, MessageSquare, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { LocalTime } from "@/components/common/LocalTime";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { deleteConversation } from "@/lib/chat/client";
import type { ConversationSummary } from "@/types";
import { useConversations } from "./ConversationsProvider";

export function ConversationList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { conversations } = useConversations();
  const [toDelete, setToDelete] = useState<ConversationSummary | null>(null);

  if (conversations.length === 0) {
    return <p className="px-2 py-1 text-xs text-muted-foreground">No chats yet.</p>;
  }

  return (
    <>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {conversations.map((conversation) => {
          const href = `/chat/${conversation.id}`;
          return (
            <li key={conversation.id} className="group/item relative">
              <Link
                href={href}
                onClick={onNavigate}
                aria-current={pathname === href ? "page" : undefined}
                className="flex items-center gap-2 rounded-md py-1.5 pr-9 pl-2 text-sm outline-none hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-sidebar-ring aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-sidebar-accent-foreground"
              >
                <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{conversation.title}</span>
                {/* Swapped for the menu button on hover, so the date doesn't shift */}
                <LocalTime
                  iso={conversation.updatedAt}
                  variant="short"
                  className="shrink-0 text-xs text-muted-foreground group-focus-within/item:invisible group-hover/item:invisible"
                />
              </Link>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Options for ${conversation.title}`}
                      className="absolute top-1/2 right-1.5 -translate-y-1/2 opacity-0 group-focus-within/item:opacity-100 group-hover/item:opacity-100 aria-expanded:opacity-100"
                    />
                  }
                >
                  <Ellipsis />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem variant="destructive" onClick={() => setToDelete(conversation)}>
                    <Trash2 />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          );
        })}
      </ul>
      <DeleteConversationDialog conversation={toDelete} onClose={() => setToDelete(null)} />
    </>
  );
}

function DeleteConversationDialog({
  conversation,
  onClose,
}: {
  conversation: ConversationSummary | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { removeConversation } = useConversations();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (!conversation) return;
    setPending(true);
    setError(null);
    try {
      await deleteConversation(conversation.id);
      removeConversation(conversation.id);
      // Don't leave the user looking at a chat that no longer exists
      if (pathname === `/chat/${conversation.id}`) {
        router.replace("/chat");
      }
      onClose();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Couldn't delete the chat.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={conversation !== null}
      onOpenChange={(open) => {
        if (!open && !pending) {
          setError(null);
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this chat?</DialogTitle>
          <DialogDescription>
            “{conversation?.title}” and all its messages will be permanently deleted. Your documents
            aren’t affected.
          </DialogDescription>
        </DialogHeader>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" disabled={pending} />}>Cancel</DialogClose>
          <Button variant="destructive" onClick={handleDelete} disabled={pending}>
            {pending && <LoaderCircle className="animate-spin" />}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
