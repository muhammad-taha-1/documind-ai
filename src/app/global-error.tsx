"use client";

import { ErrorFallback } from "@/components/common/ErrorFallback";
import "./globals.css";

/**
 * The last line of defence: an error in the root layout itself. It replaces
 * the whole document, so it brings its own <html>, <body> and styles.
 */
export default function GlobalError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en" className="dark h-full antialiased">
      <body className="flex min-h-full flex-col">
        <title>Something went wrong · DocuMind AI</title>
        <ErrorFallback {...props} />
      </body>
    </html>
  );
}
