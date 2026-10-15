"use client";

import { ChevronsUpDown, LogOut } from "lucide-react";
import { signOut } from "next-auth/react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface SidebarUser {
  name: string | null;
  email: string | null;
  image: string | null;
}

/** "Ada Lovelace" -> "AL"; falls back to the email's first letter */
function initials(user: SidebarUser): string {
  const fromName = (user.name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("");
  return (fromName || user.email?.[0] || "?").toUpperCase();
}

/**
 * The signed-in user, opening a menu with Sign out. `compact` shows just the
 * avatar, for the icon-only sidebar on tablets.
 */
export function UserMenu({ user, compact = false }: { user: SidebarUser; compact?: boolean }) {
  const displayName = user.name ?? user.email ?? "Signed in";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={compact ? `Account: ${displayName}` : undefined}
        title={compact ? displayName : undefined}
        className={cn(
          "flex items-center gap-2 rounded-md p-1.5 text-left text-sm outline-none hover:bg-sidebar-accent/60 focus-visible:ring-2 focus-visible:ring-sidebar-ring aria-expanded:bg-sidebar-accent",
          !compact && "w-full",
        )}
      >
        <Avatar size="sm">
          {user.image && <AvatarImage src={user.image} alt="" />}
          <AvatarFallback>{initials(user)}</AvatarFallback>
        </Avatar>
        {!compact && (
          <>
            <span className="min-w-0 flex-1 truncate font-medium">{displayName}</span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={compact ? "right" : "top"}
        align={compact ? "end" : "start"}
        className={cn("min-w-56", !compact && "w-(--anchor-width)")}
      >
        {user.email && (
          <>
            <DropdownMenuLabel className="truncate font-normal text-muted-foreground">{user.email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onClick={() => signOut({ callbackUrl: "/login" })}>
          <LogOut />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
