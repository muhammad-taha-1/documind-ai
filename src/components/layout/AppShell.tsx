"use client";

import { BrainCircuit, Menu } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Sidebar } from "./Sidebar";
import type { SidebarUser } from "./UserMenu";

/**
 * Sidebar + main content. On desktop the sidebar is a fixed 280px column; on
 * small screens it moves into a drawer opened from a top bar.
 */
export function AppShell({ user, children }: { user: SidebarUser; children: ReactNode }) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="flex h-dvh overflow-hidden">
      <aside className="hidden w-70 shrink-0 border-r border-sidebar-border md:block">
        <Sidebar user={user} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-2 md:hidden">
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetTrigger render={<Button variant="ghost" size="icon" aria-label="Open menu" />}>
              <Menu />
            </SheetTrigger>
            <SheetContent side="left" showCloseButton={false} className="w-70 gap-0 p-0">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <Sidebar user={user} onNavigate={() => setDrawerOpen(false)} />
            </SheetContent>
          </Sheet>
          <BrainCircuit className="size-5 text-sidebar-primary" />
          <span className="font-semibold tracking-tight">DocuMind</span>
        </header>

        <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      </div>
    </div>
  );
}
