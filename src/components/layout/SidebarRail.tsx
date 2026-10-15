"use client";

import { BrainCircuit, Files, type LucideIcon, MessageSquarePlus, PanelLeftOpen } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { type SidebarUser, UserMenu } from "./UserMenu";

const railButton = cn(
  buttonVariants({ variant: "ghost", size: "icon" }),
  "text-muted-foreground hover:text-sidebar-foreground aria-[current=page]:bg-sidebar-accent aria-[current=page]:text-sidebar-accent-foreground",
);

function RailLink({ href, label, icon: Icon }: { href: string; label: string; icon: LucideIcon }) {
  const pathname = usePathname();
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      aria-current={pathname === href ? "page" : undefined}
      className={railButton}
    >
      <Icon />
    </Link>
  );
}

/**
 * The sidebar on tablets: icons only, so the chat gets the width. Chats and
 * documents are lists, which icons can't show, so a button opens the full
 * sidebar as a drawer. Rendered inside AppShell's Sheet, which that button opens.
 */
export function SidebarRail({ user }: { user: SidebarUser }) {
  return (
    <div className="flex h-full flex-col items-center gap-1 bg-sidebar py-3 text-sidebar-foreground">
      <Link href="/dashboard" aria-label="DocuMind home" title="DocuMind" className="mb-3 rounded-md p-1.5">
        <BrainCircuit className="size-5 text-sidebar-primary" />
      </Link>
      <nav aria-label="Main" className="flex flex-1 flex-col items-center gap-1">
        <RailLink href="/dashboard" label="Documents" icon={Files} />
        <RailLink href="/chat" label="New chat" icon={MessageSquarePlus} />
        <SheetTrigger
          render={
            <button
              type="button"
              aria-label="Show chats and documents"
              title="Chats and documents"
              className={railButton}
            />
          }
        >
          <PanelLeftOpen />
        </SheetTrigger>
      </nav>
      <UserMenu user={user} compact />
    </div>
  );
}
