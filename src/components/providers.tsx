"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";

// SessionProvider uses React context, which only exists on the client, so it
// needs this "use client" wrapper before the (server) root layout can render it.
export function Providers({ children }: { children: ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
