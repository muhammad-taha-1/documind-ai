"use client";

import { ErrorFallback } from "@/components/common/ErrorFallback";

/** A dashboard page that failed to render. The sidebar above it keeps working. */
export default function DashboardError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorFallback {...props} />;
}
