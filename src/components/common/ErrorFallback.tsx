"use client";

import { RotateCw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { Button, buttonVariants } from "@/components/ui/button";

/**
 * What an error boundary shows when a page fails to render: an apology, a
 * way to try again, and a way out. In production the error's message is
 * generic (Next.js hides server details), so only its digest is shown,
 * which matches the line in the server's log.
 */
export function ErrorFallback({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    // The server logged its side already; this records what the browser saw
    console.error(error);
  }, [error]);

  return (
    <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <TriangleAlert className="size-8 text-destructive" />
      <div className="grid gap-1">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          This page couldn&apos;t be loaded. It may be a temporary problem, so trying again often works.
        </p>
        {error.digest && <p className="text-xs text-muted-foreground">Error reference: {error.digest}</p>}
      </div>
      <div className="flex gap-2">
        <Button onClick={() => retry()}>
          <RotateCw />
          Try again
        </Button>
        <Link href="/dashboard" className={buttonVariants({ variant: "outline" })}>
          Go to your documents
        </Link>
      </div>
    </div>
  );
}
