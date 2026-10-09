"use client";

import { BrainCircuit, FileText, Files, MessageSquarePlus } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConversationList } from "@/components/chat/ConversationList";
import { DocumentStatusBadge } from "@/components/documents/DocumentStatusBadge";
import { useDocumentsContext } from "@/components/documents/DocumentsProvider";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { UserMenu, type SidebarUser } from "./UserMenu";

/**
 * Documents at the top, conversations below, the signed-in user at the
 * bottom. `onNavigate` lets the mobile drawer close when a link is followed.
 */
export function Sidebar({ user, onNavigate }: { user: SidebarUser; onNavigate?: () => void }) {
  const pathname = usePathname();
  const { documents } = useDocumentsContext();

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 shrink-0 items-center gap-2 px-4">
        <BrainCircuit className="size-5 text-sidebar-primary" />
        <span className="font-semibold tracking-tight">DocuMind</span>
      </div>

      <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col gap-4 px-2 pb-2">
        <section className="flex max-h-[40%] min-h-0 flex-col gap-1">
          <SectionHeader
            label="Documents"
            action={
              <Link
                href="/dashboard"
                onClick={onNavigate}
                aria-current={pathname === "/dashboard" ? "page" : undefined}
                className={cn(
                  buttonVariants({ variant: "ghost", size: "xs" }),
                  "text-muted-foreground aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-sidebar-accent-foreground",
                )}
              >
                <Files />
                Manage
              </Link>
            }
          />
          {documents.length === 0 ? (
            <p className="px-2 py-1 text-xs text-muted-foreground">
              No documents yet.{" "}
              <Link href="/dashboard" onClick={onNavigate} className="underline underline-offset-2">
                Upload a PDF
              </Link>
            </p>
          ) : (
            <ul className="min-h-0 overflow-y-auto">
              {documents.map((document) => (
                <li
                  key={document.id}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
                  title={document.title}
                >
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{document.title}</span>
                  {/* Ready is the normal state; only flag the others */}
                  {document.status !== "READY" && <DocumentStatusBadge document={document} />}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex min-h-0 flex-1 flex-col gap-1">
          <SectionHeader
            label="Chats"
            action={
              <Link
                href="/chat"
                onClick={onNavigate}
                aria-current={pathname === "/chat" ? "page" : undefined}
                className={cn(
                  buttonVariants({ variant: "ghost", size: "xs" }),
                  "text-muted-foreground aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-sidebar-accent-foreground",
                )}
              >
                <MessageSquarePlus />
                New chat
              </Link>
            }
          />
          <ConversationList onNavigate={onNavigate} />
        </section>
      </nav>

      <div className="shrink-0 border-t border-sidebar-border p-2">
        <UserMenu user={user} />
      </div>
    </div>
  );
}

function SectionHeader({ label, action }: { label: string; action: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 pl-2">
      <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</h2>
      {action}
    </div>
  );
}
