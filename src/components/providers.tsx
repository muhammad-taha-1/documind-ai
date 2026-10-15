"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";
import { Toaster } from "@/components/ui/toast";

// SessionProvider uses React context, which only exists on the client, so it
// needs this "use client" wrapper before the (server) root layout can render it.
// Toaster shows notifications raised anywhere with `toast.add()`.
export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <Toaster>{children}</Toaster>
    </SessionProvider>
  );
}
