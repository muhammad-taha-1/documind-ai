"use client";

import { ErrorFallback } from "@/components/common/ErrorFallback";

/**
 * A page or layout below the root that failed to render, including the
 * dashboard layout itself (if its lists can't load, there's no sidebar to
 * keep). Errors within dashboard pages are caught closer, by (dashboard)/error.tsx.
 */
export default function AppError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorFallback {...props} />;
}
